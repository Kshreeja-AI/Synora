import { prisma } from '@synora/database'
import { EvaluationStatus } from '@prisma/client'
import { logger } from '../utils/logger'
import { resolveProvider } from '../ai/resolver'
import { assertAiBudget, recordAiSpend, AiBudgetExceededError } from '../ai/spend-guard'

export interface RunEvaluationJobData {
  evaluationRunId: string
  datasetId: string
  modelId: string
  workspaceId: string
  userId: string
  metrics: string[]
}

interface MetricScores {
  accuracy?: number
  bleu?: number
  rouge?: number
  f1?: number
  [key: string]: number | undefined
}

export async function processRunEvaluation(data: RunEvaluationJobData): Promise<void> {
  const { evaluationRunId } = data

  try {
    // Fetch evaluation run — the source of truth for which dataset/model/metrics
    // to evaluate. The job payload's copies of these fields may be stale or
    // absent (the "/run" route enqueues with placeholders), so it is never used.
    const evaluationRun = await prisma.evaluationRun.findUnique({
      where: { id: evaluationRunId },
    })

    if (!evaluationRun) {
      throw new Error(`Evaluation run not found: ${evaluationRunId}`)
    }

    const { datasetId, modelId, metrics, workspaceId } = evaluationRun

    logger.info(`[worker] Starting evaluation run ${evaluationRunId}`, {
      datasetId,
      modelId,
      metrics,
    })

    // Fetch the model being evaluated to know which provider/model to call
    const model = await prisma.modelRegistry.findUnique({
      where: { id: modelId },
    })

    if (!model) {
      throw new Error(`Model not found: ${modelId}`)
    }

    // The budget gate, up front for the same reason as the provider check
    // below: an evaluation run is a LOOP of generations, and the honest
    // moment to refuse an over-budget workspace is before sample one, not
    // after sample forty of a hundred.
    await assertAiBudget({ workspaceId, model: model.modelName })

    // Resolve the provider once, up front — if it isn't configured, fail the
    // whole run honestly now rather than fail every sample individually.
    const provider = await resolveProvider('text-generation', {
      explicitProviderId: model.providerId,
    })

    // Fetch dataset with samples
    const dataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
      include: {
        samples: {
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`)
    }

    // Update status to RUNNING
    await prisma.evaluationRun.update({
      where: { id: evaluationRunId },
      data: {
        status: EvaluationStatus.RUNNING,
        progress: 5,
        startedAt: new Date(),
      },
    })

    const samples = dataset.samples
    if (samples.length === 0) {
      throw new Error('Dataset has no samples to evaluate')
    }

    logger.info(`[worker] Processing ${samples.length} samples for evaluation`, {
      evaluationRunId,
      metricCount: metrics.length,
    })

    const results = []
    let successCount = 0
    let errorCount = 0

    // Process samples
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i]
      const progress = 5 + (i / samples.length) * 90

      try {
        // RE-CHECKED EVERY SAMPLE, not only before sample one.
        //
        // The up-front check above is still right — refusing an already
        // over-budget workspace before any work is the honest moment — but
        // it is not sufficient on its own. This loop calls a provider once
        // per sample, so a workspace sitting at 99% of its cap passed that
        // single gate and then burned an entire dataset: one check,
        // N generations, and a limit that could be exceeded by the whole
        // run. Re-asking here is what makes the cap bind DURING the job, so
        // an evaluation stops mid-run instead of finishing on money the
        // workspace did not have.
        await assertAiBudget({ workspaceId })

        const generation = await provider.generateText({
          prompt: sample.input,
          model: model.modelName,
        })
        // This path bypasses instrumentedGenerate (it holds its own provider
        // instance), so it charges its own spend — raw counts, never ?? 0.
        await recordAiSpend({
          workspaceId,
          provider: generation.provider,
          model: generation.model,
          inputTokens: generation.usage?.inputTokens,
          outputTokens: generation.usage?.outputTokens,
          fallbackChars: sample.input.length + generation.text.length,
        })
        const prediction = generation.text

        // Calculate metrics
        const metricScores = await calculateMetrics(
          prediction,
          sample.output || '',
          metrics
        )

        // Calculate overall score (average of all metrics)
        const allScores = Object.values(metricScores).filter((v) => v !== undefined) as number[]
        const overallScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b) / allScores.length : 0

        // Store result
        const result = await prisma.evaluationResult.create({
          data: {
            evaluationRunId,
            sampleId: sample.id,
            prediction,
            groundTruth: sample.output,
            score: overallScore,
            metrics: metricScores,
          },
        })

        results.push(result)
        successCount++

        // Update progress every 10 samples
        if ((i + 1) % 10 === 0) {
          await prisma.evaluationRun.update({
            where: { id: evaluationRunId },
            data: { progress },
          })
        }
      } catch (sampleError) {
        // A budget refusal STOPS the run rather than failing every
        // remaining sample one at a time. Continuing would write N
        // "PREDICTION_FAILED" rows for a limit the workspace set — blaming
        // the model for a decision the founder made — and would leave an
        // operator reading a broken-looking evaluation instead of a
        // budget message.
        if (sampleError instanceof AiBudgetExceededError) {
          logger.warn('[worker] Evaluation stopped: AI budget reached mid-run', {
            evaluationRunId,
            stoppedAtSample: i,
            totalSamples: samples.length,
            scope: sampleError.scope,
            limit: sampleError.limit,
          })
          break
        }

        errorCount++
        logger.warn(`[worker] Failed to evaluate sample ${sample.id}`, {
          evaluationRunId,
          sampleId: sample.id,
          error: sampleError instanceof Error ? sampleError.message : String(sampleError),
        })

        // Store error result
        await prisma.evaluationResult.create({
          data: {
            evaluationRunId,
            sampleId: sample.id,
            prediction: '',
            groundTruth: sample.output,
            score: 0,
            error: sampleError instanceof Error ? sampleError.message : 'Unknown error',
            errorType: 'PREDICTION_FAILED',
          },
        })
      }
    }

    // Calculate summary statistics
    const completedResults = results.filter((r) => !r.error)
    const averageScore = completedResults.length > 0
      ? completedResults.reduce((sum, r) => sum + r.score, 0) / completedResults.length
      : 0

    logger.info(`[worker] Evaluation summary`, {
      evaluationRunId,
      totalSamples: samples.length,
      successCount,
      errorCount,
      averageScore: averageScore.toFixed(4),
    })

    // Update evaluation run to COMPLETED
    await prisma.evaluationRun.update({
      where: { id: evaluationRunId },
      data: {
        status: EvaluationStatus.COMPLETED,
        progress: 100,
        completedAt: new Date(),
      },
    })

    logger.info(`[worker] Evaluation run completed successfully`, {
      evaluationRunId,
      datasetId,
      modelId,
      samplesEvaluated: results.length,
      averageScore: averageScore.toFixed(4),
    })
  } catch (error) {
    logger.error(`[worker] Evaluation run failed`, {
      evaluationRunId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    try {
      await prisma.evaluationRun.update({
        where: { id: evaluationRunId },
        data: {
          status: EvaluationStatus.FAILED,
          progress: 0,
          completedAt: new Date(),
        },
      })
    } catch (updateError) {
      logger.error(`[worker] Failed to update evaluation run status after error`, {
        evaluationRunId,
        updateError: updateError instanceof Error ? updateError.message : String(updateError),
      })
    }

    throw error
  }
}

async function calculateMetrics(
  prediction: string,
  groundTruth: string,
  metrics: string[]
): Promise<MetricScores> {
  const scores: MetricScores = {}

  for (const metric of metrics) {
    switch (metric.toUpperCase()) {
      case 'ACCURACY':
        scores.accuracy = calculateAccuracy(prediction, groundTruth)
        break
      case 'BLEU':
        scores.bleu = calculateBLEU(prediction, groundTruth)
        break
      case 'ROUGE':
        scores.rouge = calculateROUGE(prediction, groundTruth)
        break
      case 'F1':
        scores.f1 = calculateF1(prediction, groundTruth)
        break
      default:
        // Custom metric: string similarity
        scores[metric.toLowerCase()] = calculateStringSimilarity(prediction, groundTruth)
    }
  }

  return scores
}

function calculateAccuracy(prediction: string, groundTruth: string): number {
  if (prediction === groundTruth) return 1.0
  // Normalized edit distance
  const distance = levenshteinDistance(prediction, groundTruth)
  const maxLen = Math.max(prediction.length, groundTruth.length)
  return Math.max(0, 1 - distance / maxLen)
}

function calculateBLEU(prediction: string, groundTruth: string): number {
  // Simplified BLEU: unigram precision
  const predTokens = prediction.toLowerCase().split(/\s+/)
  const truthTokens = groundTruth.toLowerCase().split(/\s+/)

  const predSet = new Set(predTokens)
  const matches = truthTokens.filter((token) => predSet.has(token)).length

  return truthTokens.length > 0 ? matches / truthTokens.length : 0
}

function calculateROUGE(prediction: string, groundTruth: string): number {
  // Simplified ROUGE-L: longest common subsequence ratio
  const lcs = longestCommonSubsequence(prediction, groundTruth)
  const maxLen = Math.max(prediction.length, groundTruth.length)
  return maxLen > 0 ? lcs / maxLen : 0
}

function calculateF1(prediction: string, groundTruth: string): number {
  // Simplified F1: based on token overlap
  const predTokens = new Set(prediction.toLowerCase().split(/\s+/))
  const truthTokens = new Set(groundTruth.toLowerCase().split(/\s+/))

  const intersection = new Set([...predTokens].filter((x) => truthTokens.has(x)))
  const precision = predTokens.size > 0 ? intersection.size / predTokens.size : 0
  const recall = truthTokens.size > 0 ? intersection.size / truthTokens.size : 0

  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
}

function calculateStringSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a

  if (longer.length === 0) return 1.0

  const distance = levenshteinDistance(longer, shorter)
  return (longer.length - distance) / longer.length
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

function longestCommonSubsequence(a: string, b: string): number {
  const matrix: number[][] = Array(a.length + 1)
    .fill(null)
    .map(() => Array(b.length + 1).fill(0))

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1
      } else {
        matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1])
      }
    }
  }

  return matrix[a.length][b.length]
}
