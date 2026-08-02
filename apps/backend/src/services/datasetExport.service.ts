import { prisma } from '@synora/database'
import { NotFoundException, ValidationException } from '@synora/shared'
import { logger } from '../utils/logger'
import { requireMembership } from './checks'
import { ExportFormat, ExportStatus } from '@prisma/client'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// Formats declared in the ExportFormat enum with a writer actually implemented
// in export-dataset.worker.ts. Keep in sync with that file's writeExportFile —
// rejecting here means a caller never gets billed a queued job that is
// guaranteed to fail.
const SUPPORTED_FORMATS: readonly ExportFormat[] = [
  ExportFormat.JSONL,
  ExportFormat.JSON,
  ExportFormat.CSV,
]

export interface ExportDatasetInput {
  datasetId: string
  format: ExportFormat
  includePII?: boolean
  maxSamples?: number
}

export class DatasetExportService {
  /**
   * Validates the request and creates a PENDING export record. The actual
   * file (dedup, PII sanitization, writing, checksum) is produced exactly
   * once, by the queued worker (export-dataset.worker.ts) — this method used
   * to also write the file synchronously, which meant every export ran
   * twice and raced its own background job over the same DB row.
   */
  async exportDataset(
    userId: string,
    workspaceId: string,
    input: ExportDatasetInput
  ): Promise<{ exportId: string; status: ExportStatus }> {
    const membership = await requireMembership(userId, workspaceId)
    if (membership.role !== 'OWNER' && membership.role !== 'EDITOR') {
      throw new ValidationException('Insufficient permissions to export dataset')
    }

    if (!SUPPORTED_FORMATS.includes(input.format)) {
      throw new ValidationException(
        `Export format ${input.format} is not yet supported. Supported formats: ${SUPPORTED_FORMATS.join(', ')}.`
      )
    }

    const dataset = await prisma.dataset.findUnique({
      where: { id: input.datasetId },
    })

    if (!dataset || dataset.workspaceId !== workspaceId) {
      throw new NotFoundException('Dataset not found')
    }

    const trainingExport = await prisma.trainingExport.create({
      data: {
        datasetId: input.datasetId,
        format: input.format,
        status: ExportStatus.PENDING,
        workspaceId,
      },
    })

    logger.info(`[datasetExport] Export ${trainingExport.id} queued for dataset ${dataset.id}`, {
      workspaceId,
      userId,
      datasetId: input.datasetId,
      format: input.format,
    })

    return {
      exportId: trainingExport.id,
      status: trainingExport.status,
    }
  }

  async getExportStatus(
    userId: string,
    workspaceId: string,
    exportId: string
  ): Promise<{ export: any; status: ExportStatus }> {
    await requireMembership(userId, workspaceId)

    const trainingExport = await prisma.trainingExport.findUnique({
      where: { id: exportId },
      include: { dataset: true },
    })

    if (!trainingExport || trainingExport.dataset.workspaceId !== workspaceId) {
      throw new NotFoundException('Export not found')
    }

    return {
      // fileSize is a Prisma BigInt, which JSON.stringify cannot serialize —
      // convert it at the API boundary rather than passing the raw row through.
      export: {
        ...trainingExport,
        fileSize: trainingExport.fileSize === null ? null : trainingExport.fileSize.toString(),
      },
      status: trainingExport.status,
    }
  }

  async deleteExport(
    userId: string,
    workspaceId: string,
    exportId: string
  ): Promise<void> {
    const membership = await requireMembership(userId, workspaceId)
    if (membership.role !== 'OWNER' && membership.role !== 'EDITOR') {
      throw new ValidationException('Insufficient permissions to delete export')
    }

    const trainingExport = await prisma.trainingExport.findUnique({
      where: { id: exportId },
      include: { dataset: true },
    })

    if (!trainingExport || trainingExport.dataset.workspaceId !== workspaceId) {
      throw new NotFoundException('Export not found')
    }

    try {
      if (trainingExport.fileUrl) {
        const filePath = path.join(process.cwd(), trainingExport.fileUrl)
        await fs.unlink(filePath)
      }
    } catch {
      logger.warn(`[datasetExport] Failed to delete file for export ${exportId}`)
    }

    await prisma.trainingExport.delete({
      where: { id: exportId },
    })

    logger.info(`[datasetExport] Export ${exportId} deleted`, { workspaceId, userId })
  }
}

export const datasetExportService = new DatasetExportService()
