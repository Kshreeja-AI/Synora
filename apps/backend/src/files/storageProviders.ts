import { FileStorageProvider } from './types';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

function assertWithinDir(base: string, target: string): void {
  const resolved = path.resolve(target);
  const resolvedBase = path.resolve(base);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error('Path traversal detected');
  }
}

export class LocalStorageProvider implements FileStorageProvider {
  private uploadDir: string;

  constructor(uploadDir: string = '/tmp/synora-uploads') {
    this.uploadDir = uploadDir;
  }

  async upload(
    key: string,
    buffer: Buffer,
    _mimeType: string,
    _metadata?: Record<string, string>
  ): Promise<{ url: string; key: string }> {
    try {
      const fullPath = path.join(this.uploadDir, key);
      assertWithinDir(this.uploadDir, fullPath);
      const dir = path.dirname(fullPath);

      // Create directory if it doesn't exist
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, buffer);

      logger.info('[LocalStorage] File uploaded', { key, size: buffer.length });
      return { url: `/files/${key}`, key };
    } catch (error: any) {
      logger.error('[LocalStorage] Upload failed', { key, error: error.message });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const fullPath = path.join(this.uploadDir, key);
      assertWithinDir(this.uploadDir, fullPath);
      await fs.unlink(fullPath);
      logger.info('[LocalStorage] File deleted', { key });
    } catch (error: any) {
      // Ignore if file doesn't exist
      if ((error as any).code !== 'ENOENT') {
        logger.error('[LocalStorage] Delete failed', { key, error: error.message });
        throw error;
      }
    }
  }

  async download(key: string): Promise<Buffer> {
    try {
      const fullPath = path.join(this.uploadDir, key);
      assertWithinDir(this.uploadDir, fullPath);
      const buffer = await fs.readFile(fullPath);
      logger.info('[LocalStorage] File downloaded', { key, size: buffer.length });
      return buffer;
    } catch (error: any) {
      logger.error('[LocalStorage] Download failed', { key, error: error.message });
      throw error;
    }
  }

  async getPresignedUrl(key: string, _expirationSeconds?: number): Promise<string> {
    return `/files/${key}`;
  }
}

export class S3StorageProvider implements FileStorageProvider {
  private s3Client: any;
  private bucket: string;

  constructor(s3Client: any, bucket: string) {
    this.s3Client = s3Client;
    this.bucket = bucket;
  }

  async upload(
    key: string,
    buffer: Buffer,
    mimeType: string,
    metadata?: Record<string, string>
  ): Promise<{ url: string; key: string }> {
    try {
      await this.s3Client.putObject({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        Metadata: metadata || {},
      });

      logger.info('[S3Storage] File uploaded', { bucket: this.bucket, key, size: buffer.length });
      return {
        url: `https://${this.bucket}.s3.amazonaws.com/${key}`,
        key,
      };
    } catch (error: any) {
      logger.error('[S3Storage] Upload failed', { key, error: error.message });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.s3Client.deleteObject({
        Bucket: this.bucket,
        Key: key,
      });
      logger.info('[S3Storage] File deleted', { bucket: this.bucket, key });
    } catch (error: any) {
      logger.error('[S3Storage] Delete failed', { key, error: error.message });
      throw error;
    }
  }

  async download(key: string): Promise<Buffer> {
    try {
      const response = await this.s3Client.getObject({
        Bucket: this.bucket,
        Key: key,
      });
      const buffer = Buffer.concat(response.Body);
      logger.info('[S3Storage] File downloaded', { key, size: buffer.length });
      return buffer;
    } catch (error: any) {
      logger.error('[S3Storage] Download failed', { key, error: error.message });
      throw error;
    }
  }

  async getPresignedUrl(key: string, expirationSeconds: number = 3600): Promise<string> {
    try {
      const url = await this.s3Client.getSignedUrlPromise('getObject', {
        Bucket: this.bucket,
        Key: key,
        Expires: expirationSeconds,
      });
      return url;
    } catch (error: any) {
      logger.error('[S3Storage] Presigned URL generation failed', { key, error: error.message });
      throw error;
    }
  }
}
