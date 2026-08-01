import { prisma } from '@synora/database'
import { NotFoundException, ValidationException } from '@synora/shared'
import { logger } from '../utils/logger'
import { requireMembership } from './checks'
import { ExportFormat, ExportStatus } from '@prisma/client'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface ExportDatasetInput {
  datasetId: string
  format: ExportFormat
  includePII?: boolean
  maxSamples?: number
}

export interface ExportStats {
  totalSamples: number
  samplesExported: number
  duplicatesRemoved: number
  qualityScore: number
  format: ExportFormat
  fileSize: number
  checksumSHA256: string
}

export class DatasetExportService {
  async exportDataset(
    userId: string,
    workspaceId: string,
    input: ExportDatasetInput
  ): Promise<{ exportId: string; stats: ExportStats; url: string }> {
    const membership = await requireMembership(userId, workspaceId)
    if (membership.role !== 'OWNER' && membership.role !== 'EDITOR') {
      throw new ValidationException('Insufficient permissions to export dataset')
    }

    const dataset = await prisma.dataset.findUnique({
      where: { id: input.datasetId },
      include: { samples: { include: { labels: true } } },
    })

    if (!dataset || dataset.workspaceId !== workspaceId) {
      throw new NotFoundException('Dataset not found')
    }

    const stats: ExportStats = {
      totalSamples: dataset.samples?.length || 0,
      samplesExported: 0,
      duplicatesRemoved: 0,
      qualityScore: dataset.averageQuality || 0,
      format: input.format,
      fileSize: 0,
      checksumSHA256: '',
    }

    let exportedSamples: any[] = []

    if (dataset.samples && dataset.samples.length > 0) {
      exportedSamples = dataset.samples.map((sample: any) => ({
        id: sample.id,
        input: sample.input,
        output: sample.output,
        conversationId: sample.conversationId,
        sourceType: sample.sourceType,
        qualityScore: sample.qualityScore,
        labels: sample.labels?.map((l: any) => l.name) || [],
      }))
    }

    const beforeDedupCount = exportedSamples.length
    exportedSamples = this.deduplicateSamples(exportedSamples)
    stats.duplicatesRemoved = beforeDedupCount - exportedSamples.length

    if (input.maxSamples && exportedSamples.length > input.maxSamples) {
      exportedSamples = exportedSamples.slice(0, input.maxSamples)
    }

    stats.samplesExported = exportedSamples.length

    const fileName = `${dataset.id}-${input.format.toLowerCase()}-${randomUUID()}.${this.getFileExtension(input.format)}`
    const filePath = path.join(process.cwd(), 'exports', fileName)

    await this.writeExportFile(filePath, exportedSamples, input.format)

    const fileStats = await fs.stat(filePath)
    stats.fileSize = fileStats.size

    stats.checksumSHA256 = await this.calculateChecksum(filePath)

    const trainingExport = await prisma.trainingExport.create({
      data: {
        datasetId: input.datasetId,
        format: input.format,
        storageKey: fileName,
        fileSize: stats.fileSize,
        checksum: stats.checksumSHA256,
        samplesCount: stats.samplesExported,
        status: ExportStatus.COMPLETED,
        createdBy: userId,
        workspaceId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    logger.info(`[datasetExport] Dataset ${dataset.id} exported`, {
      workspaceId,
      userId,
      datasetId: input.datasetId,
      samplesCount: stats.samplesExported,
    })

    return {
      exportId: trainingExport.id,
      stats,
      url: `/api/workspaces/${workspaceId}/datasets/${dataset.id}/exports/${trainingExport.id}/download`,
    }
  }

  private deduplicateSamples(samples: any[]): any[] {
    const seen = new Set<string>()
    const deduped: any[] = []

    for (const sample of samples) {
      const key = `${sample.input}:${sample.output || ''}`
      if (!seen.has(key)) {
        seen.add(key)
        deduped.push(sample)
      }
    }

    return deduped
  }

  private async writeExportFile(
    filePath: string,
    samples: any[],
    format: ExportFormat
  ): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    if (format === ExportFormat.JSONL) {
      const lines = samples.map((s) => JSON.stringify(s)).join('\n')
      await fs.writeFile(filePath, lines, 'utf-8')
    } else if (format === ExportFormat.JSON) {
      await fs.writeFile(filePath, JSON.stringify(samples, null, 2), 'utf-8')
    } else if (format === ExportFormat.CSV) {
      const headers = Object.keys(samples[0] || {})
      const rows = samples.map((s) =>
        headers.map((h) => {
          const value = s[h]
          const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
          return `"${stringValue.replace(/"/g, '""')}"`
        })
      )
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
      await fs.writeFile(filePath, csv, 'utf-8')
    }
  }

  private getFileExtension(format: ExportFormat): string {
    switch (format) {
      case ExportFormat.JSONL:
        return 'jsonl'
      case ExportFormat.JSON:
        return 'json'
      case ExportFormat.CSV:
        return 'csv'
      case ExportFormat.PARQUET:
        return 'parquet'
      default:
        return 'txt'
    }
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    const crypto = await import('node:crypto')
    const hash = crypto.createHash('sha256')
    const fileContent = await fs.readFile(filePath)
    hash.update(fileContent)
    return hash.digest('hex')
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
      export: trainingExport,
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
      const filePath = path.join(process.cwd(), 'exports', trainingExport.storageKey)
      await fs.unlink(filePath)
    } catch (error) {
      logger.warn(`[datasetExport] Failed to delete file for export ${exportId}`)
    }

    await prisma.trainingExport.delete({
      where: { id: exportId },
    })

    logger.info(`[datasetExport] Export ${exportId} deleted`, { workspaceId, userId })
  }
}

export const datasetExportService = new DatasetExportService()
