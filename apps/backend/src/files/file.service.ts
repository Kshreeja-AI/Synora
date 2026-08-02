import { prisma } from '@synora/database';
import { ConversationFile } from '@prisma/client';
import { NotFoundException, ForbiddenException } from '@synora/shared';
import { FileStorageProvider } from './types';
import { processorRegistry } from './processors';
import { virusScanProvider } from './virusScan';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export interface UploadFileInput {
  conversationId: string;
  workspaceId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  uploadedBy: string;
}

export class FileService {
  constructor(private storage: FileStorageProvider) {}

  async uploadFile(input: UploadFileInput): Promise<{
    id: string;
    fileName: string;
    url: string;
    status: string;
  }> {
    const { conversationId, workspaceId, fileName, mimeType, buffer, uploadedBy } = input;

    try {
      // Validate file size (max 100MB)
      if (buffer.length > 100 * 1024 * 1024) {
        throw new Error('File exceeds maximum size of 100MB');
      }

      // Validate conversation access
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      if (!conversation || conversation.workspaceId !== workspaceId) {
        throw new Error('Conversation not found or not accessible');
      }

      // Generate storage key (workspace/conversation/hash/filename)
      const fileHash = crypto.randomBytes(8).toString('hex');
      const storageKey = `workspaces/${workspaceId}/conversations/${conversationId}/${fileHash}/${fileName}`;

      // Upload to storage
      const { url } = await this.storage.upload(storageKey, buffer, mimeType, {
        originalName: fileName,
        conversationId,
        workspaceId,
        uploadedBy,
      });

      // Create database record
      const file = await prisma.conversationFile.create({
        data: {
          conversationId,
          workspaceId,
          fileName,
          mimeType,
          fileSize: buffer.length,
          storageKey,
          uploadedBy,
          processingStatus: 'PENDING',
          virusScanStatus: 'PENDING',
        },
      });

      logger.info('[FileService] File uploaded', {
        fileId: file.id,
        fileName,
        size: buffer.length,
      });

      return {
        id: file.id,
        fileName: file.fileName,
        url,
        status: 'PENDING',
      };
    } catch (error: any) {
      logger.error('[FileService] Upload failed', {
        conversationId,
        fileName,
        error: error.message,
      });
      throw error;
    }
  }

  async deleteFile(fileId: string, workspaceId: string): Promise<void> {
    try {
      const file = await prisma.conversationFile.findUnique({
        where: { id: fileId },
      });

      if (!file || file.workspaceId !== workspaceId) {
        throw new Error('File not found or not accessible');
      }

      // Delete from storage
      await this.storage.delete(file.storageKey);

      // Delete from database
      await prisma.conversationFile.delete({
        where: { id: fileId },
      });

      logger.info('[FileService] File deleted', { fileId, fileName: file.fileName });
    } catch (error: any) {
      logger.error('[FileService] Delete failed', { fileId, error: error.message });
      throw error;
    }
  }

  /**
   * Fetch a file's record and raw bytes for download.
   *
   * Scoping is deliberately strict: the file must belong to BOTH the
   * workspace (the authorization boundary — the route has already
   * verified membership) and the conversation named in the URL, so a
   * valid file id can't be pulled through a different conversation's
   * path. Infected files are never served — the whole point of
   * scanning is that the quarantine holds.
   */
  async downloadFile(
    fileId: string,
    workspaceId: string,
    conversationId: string
  ): Promise<{ file: ConversationFile; buffer: Buffer }> {
    const file = await prisma.conversationFile.findUnique({
      where: { id: fileId },
    });

    if (
      !file ||
      file.workspaceId !== workspaceId ||
      file.conversationId !== conversationId ||
      file.isArchived
    ) {
      throw new NotFoundException('File not found');
    }

    if (file.virusScanStatus === 'INFECTED') {
      logger.warn('[FileService] Blocked download of infected file', {
        fileId,
        fileName: file.fileName,
      });
      throw new ForbiddenException('This file failed a security scan and cannot be downloaded');
    }

    const buffer = await this.storage.download(file.storageKey);
    return { file, buffer };
  }

  async getConversationFiles(conversationId: string, workspaceId: string) {
    try {
      const files = await prisma.conversationFile.findMany({
        where: {
          conversationId,
          workspaceId,
          isArchived: false,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          fileSize: true,
          processingStatus: true,
          virusScanStatus: true,
          extractedText: true,
          createdAt: true,
        },
      });

      return files;
    } catch (error: any) {
      logger.error('[FileService] Get files failed', {
        conversationId,
        error: error.message,
      });
      throw error;
    }
  }

  async processFile(fileId: string): Promise<void> {
    try {
      const file = await prisma.conversationFile.findUnique({
        where: { id: fileId },
      });

      if (!file) {
        throw new Error('File not found');
      }

      // Mark as processing
      await prisma.conversationFile.update({
        where: { id: fileId },
        data: { processingStatus: 'PROCESSING' },
      });

      // Create processing job
      await prisma.fileProcessingJob.create({
        data: {
          fileId,
          status: 'PROCESSING',
        },
      });

      // Download from storage
      const buffer = await this.storage.download(file.storageKey);

      // Virus scan
      const scanResult = await virusScanProvider.scan(buffer, file.fileName);
      let virusScanStatus: 'CLEAN' | 'INFECTED' = 'CLEAN';
      let virusScanError: string | null = null;

      if (!scanResult.clean) {
        virusScanStatus = 'INFECTED';
        virusScanError = scanResult.error || 'Unknown virus detected';
        logger.warn('[FileService] Virus detected', { fileId, error: virusScanError });
      }

      // Process file content
      const processResult = await processorRegistry.process(buffer, file.mimeType);

      // Update file record
      await prisma.conversationFile.update({
        where: { id: fileId },
        data: {
          processingStatus: processResult.success ? 'COMPLETED' : 'FAILED',
          virusScanStatus,
          virusScanError,
          extractedText: processResult.extractedText,
          processedAt: new Date(),
        },
      });

      // Mark job as completed
      await prisma.fileProcessingJob.update({
        where: { fileId },
        data: {
          status: processResult.success ? 'COMPLETED' : 'FAILED',
          completedAt: new Date(),
          lastError: processResult.error,
        },
      });

      logger.info('[FileService] File processed', {
        fileId,
        fileName: file.fileName,
        success: processResult.success,
      });
    } catch (error: any) {
      logger.error('[FileService] Processing failed', { fileId, error: error.message });

      // Update job status
      await prisma.fileProcessingJob.updateMany({
        where: { fileId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          lastError: error.message,
        },
      });

      await prisma.conversationFile.update({
        where: { id: fileId },
        data: {
          processingStatus: 'FAILED',
          processingError: error.message,
        },
      });

      // Rethrow after recording: the queue's retry/backoff only
      // engages on a thrown error. A successful retry overwrites the
      // FAILED status above, so recording first loses nothing.
      throw error;
    }
  }
}
