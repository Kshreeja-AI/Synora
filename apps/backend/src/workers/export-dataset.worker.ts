import { prisma } from '@synora/database'
import { ExportFormat, ExportStatus } from '@prisma/client'
import { logger } from '../utils/logger'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

export interface ExportDatasetJobData {
  exportId: string
  datasetId: string
  workspaceId: string
  userId: string
  format: ExportFormat
  includePII: boolean
  maxSamples?: number
}

interface PII_PATTERNS {
  email: RegExp
  phone: RegExp
  ssn: RegExp
  creditCard: RegExp
}

const PII_PATTERNS: PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
}

export async function processExportDataset(data: ExportDatasetJobData): Promise<void> {
  const { exportId, datasetId, format, includePII, maxSamples } = data

  try {
    logger.info(`[worker] Starting dataset export ${exportId}`, {
      datasetId,
      format,
      includePII,
      maxSamples,
    })

    // Fetch export record and validate
    const trainingExport = await prisma.trainingExport.findUnique({
      where: { id: exportId },
    })

    if (!trainingExport) {
      throw new Error(`Export record not found: ${exportId}`)
    }

    // Fetch dataset with samples
    const dataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
      include: {
        samples: {
          include: { labels: true, splits: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`)
    }

    // Update status to PROCESSING
    await prisma.trainingExport.update({
      where: { id: exportId },
      data: { status: ExportStatus.PROCESSING, progress: 10 },
    })

    // Extract and prepare samples
    let exportedSamples = dataset.samples.map((sample) => ({
      id: sample.id,
      input: includePII ? sample.input : sanitizePII(sample.input),
      output: includePII ? sample.output : sanitizePII(sample.output),
      sourceType: sample.sourceType,
      qualityScore: sample.qualityScore,
      confidence: sample.confidence,
      labels: sample.labels?.map((l) => l.labelValue) || [],
      splits: sample.splits?.map((s) => s.splitType) || [],
    }))

    logger.info(`[worker] Extracted ${exportedSamples.length} samples`, {
      exportId,
      beforeDedup: exportedSamples.length,
    })

    // Deduplication
    const beforeDedup = exportedSamples.length
    exportedSamples = deduplicateSamples(exportedSamples)
    const duplicatesRemoved = beforeDedup - exportedSamples.length

    logger.info(`[worker] Deduplication complete`, {
      exportId,
      duplicatesRemoved,
      afterDedup: exportedSamples.length,
    })

    // Apply max samples limit
    if (maxSamples && exportedSamples.length > maxSamples) {
      exportedSamples = exportedSamples.slice(0, maxSamples)
    }

    // Calculate quality score (average of sample quality scores)
    const qualityScore =
      exportedSamples.length > 0
        ? exportedSamples.reduce((sum, s) => sum + (s.qualityScore || 0.5), 0) /
          exportedSamples.length
        : 0

    await prisma.trainingExport.update({
      where: { id: exportId },
      data: { progress: 40 },
    })

    // Write export file
    const fileName = `${datasetId}-${format.toLowerCase()}-${Date.now()}.${getFileExtension(format)}`
    const exportsDir = path.join(process.cwd(), 'exports')
    const filePath = path.join(exportsDir, fileName)

    await fs.mkdir(exportsDir, { recursive: true })

    await writeExportFile(filePath, exportedSamples, format)

    const fileStats = await fs.stat(filePath)
    const fileSize = fileStats.size
    const checksum = await calculateChecksum(filePath)

    logger.info(`[worker] Export file written`, {
      exportId,
      fileName,
      fileSize,
      checksum,
    })

    await prisma.trainingExport.update({
      where: { id: exportId },
      data: { progress: 85 },
    })

    // Update export record with final data
    await prisma.trainingExport.update({
      where: { id: exportId },
      data: {
        status: ExportStatus.COMPLETED,
        progress: 100,
        fileSize: BigInt(fileSize),
        fileUrl: `/exports/${fileName}`,
        checksum,
        completedAt: new Date(),
      },
    })

    logger.info(`[worker] Dataset export completed successfully`, {
      exportId,
      datasetId,
      format,
      samplesExported: exportedSamples.length,
      duplicatesRemoved,
      qualityScore: qualityScore.toFixed(2),
      fileSize,
      checksum,
    })
  } catch (error) {
    logger.error(`[worker] Dataset export failed`, {
      exportId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    try {
      await prisma.trainingExport.update({
        where: { id: exportId },
        data: {
          status: ExportStatus.FAILED,
          progress: 0,
        },
      })
    } catch (updateError) {
      logger.error(`[worker] Failed to update export status after error`, {
        exportId,
        updateError: updateError instanceof Error ? updateError.message : String(updateError),
      })
    }

    throw error
  }
}

function sanitizePII(text: string): string {
  let sanitized = text
  sanitized = sanitized.replace(PII_PATTERNS.email, '[EMAIL_REDACTED]')
  sanitized = sanitized.replace(PII_PATTERNS.phone, '[PHONE_REDACTED]')
  sanitized = sanitized.replace(PII_PATTERNS.ssn, '[SSN_REDACTED]')
  sanitized = sanitized.replace(PII_PATTERNS.creditCard, '[CC_REDACTED]')
  return sanitized
}

function deduplicateSamples(samples: any[]): any[] {
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

function getFileExtension(format: ExportFormat): string {
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

async function writeExportFile(filePath: string, samples: any[], format: ExportFormat): Promise<void> {
  if (samples.length === 0) {
    throw new Error('No samples to export')
  }

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
        const stringValue =
          typeof value === 'object' ? JSON.stringify(value) : String(value || '')
        return `"${stringValue.replace(/"/g, '""')}"`
      })
    )
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    await fs.writeFile(filePath, csv, 'utf-8')
  } else if (format === ExportFormat.PARQUET) {
    // PARQUET requires parquetjs library, store as JSON for now with warning
    logger.warn(`[worker] PARQUET format not yet implemented, using JSON instead`)
    await fs.writeFile(filePath, JSON.stringify(samples, null, 2), 'utf-8')
  }
}

async function calculateChecksum(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const fileContent = await fs.readFile(filePath)
  hash.update(fileContent)
  return hash.digest('hex')
}
