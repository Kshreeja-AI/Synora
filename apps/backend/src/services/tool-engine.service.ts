import { prisma } from '@synora/database'
import { ToolDefinition, ExecutionStatus, ToolType } from '@prisma/client'
import { ValidationException } from '@synora/shared'
import { logger } from '../utils/logger'
import type { InputJsonValue } from '@prisma/client/runtime/library'
import {
  performHttpToolRequest,
  ToolTransportError,
  type AddressPolicy,
  type HttpToolRequest,
} from './tool-transport'

/**
 * Tool execution engine. Executes HTTP and Webhook tool definitions for
 * real — an outbound, SSRF-guarded HTTP request built from the tool's
 * config, with the tool's own timeout, retry budget, and a per-tool
 * circuit breaker. Tool types without a real executor (Database, Python,
 * Browser, …) are rejected at request time by tool.service rather than
 * "succeeding" with fabricated output; support for a type is only
 * declared here once it genuinely executes.
 */

/** Tool types the engine can actually execute today. */
export const SUPPORTED_EXECUTION_TYPES: ReadonlySet<ToolType> = new Set([
  ToolType.HTTP,
  ToolType.Webhook,
])

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
const SECRET_PLACEHOLDER = /\{\{secret:([A-Za-z0-9_.-]+)\}\}/g

/**
 * Single source of required-field validation for tool input, shared by
 * the execute route (via tool.service) so a request with missing fields
 * fails with a 400 before an execution record ever exists.
 */
export function validateToolInput(
  input: Record<string, unknown>,
  schema: Record<string, unknown> | null | undefined
): void {
  if (!schema || typeof schema !== 'object') {
    return
  }
  const required = (schema.required || []) as string[]
  for (const field of required) {
    if (!(field in input)) {
      throw new ValidationException(`Missing required field: ${field}`)
    }
  }
}

interface HttpToolConfig {
  url?: unknown
  method?: unknown
  headers?: unknown
}

/** Terminal write for one execution attempt loop. */
interface TerminalResult {
  status: ExecutionStatus
  output?: Record<string, unknown>
  error?: string
}

export class ToolEngineService {
  private readonly RETRY_BACKOFF_MS = [500, 1500, 5000]
  private readonly MAX_ATTEMPTS_CAP = 5
  private readonly CIRCUIT_BREAKER_THRESHOLD = 0.5 // 50% failure rate
  private readonly CIRCUIT_BREAKER_TIMEOUT_MS = 60000 // 1 minute
  private circuitBreakerState = new Map<
    string,
    { open: boolean; failureCount: number; successCount: number; lastFailure: Date }
  >()

  /**
   * Run an already-created execution record to completion: resolve
   * secrets, build the outbound request, attempt it under the tool's
   * retry budget, and record the truthful terminal state (COMPLETED /
   * FAILED / TIMEOUT) with timing. Never throws — the execution record
   * is the error channel for this async path.
   */
  async executeWithRetries(
    executionId: string,
    toolId: string,
    input: Record<string, unknown>,
    options?: { timeout?: number; addressPolicy?: AddressPolicy }
  ): Promise<void> {
    const tool = await prisma.toolDefinition.findUnique({ where: { id: toolId } })
    if (!tool) {
      await this.finalize(executionId, null, {
        status: ExecutionStatus.FAILED,
        error: 'Tool definition no longer exists',
      })
      return
    }

    const breaker = this.getCircuitBreakerState(toolId)
    if (breaker.open) {
      await this.finalize(executionId, null, {
        status: ExecutionStatus.FAILED,
        error: 'Tool circuit breaker is open (too many recent failures)',
      })
      return
    }

    const startedAt = new Date()
    await prisma.toolExecution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.RUNNING, startedAt },
    })

    let request: HttpToolRequest
    try {
      request = await this.buildHttpRequest(tool, input, options?.timeout)
    } catch (error) {
      // Configuration problems (bad URL, missing secret) are not
      // transient; retrying would just repeat them.
      await this.finalize(executionId, startedAt, {
        status: ExecutionStatus.FAILED,
        error: error instanceof Error ? error.message : String(error),
      })
      this.recordFailure(toolId)
      return
    }

    const maxAttempts = Math.min(Math.max(tool.maxRetries, 1), this.MAX_ATTEMPTS_CAP)
    let lastError = 'Tool execution failed'
    let lastTimedOut = false

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await performHttpToolRequest(
          request,
          options?.addressPolicy
        )

        if (response.statusCode >= 200 && response.statusCode < 300) {
          await this.finalize(
            executionId,
            startedAt,
            {
              status: ExecutionStatus.COMPLETED,
              output: { statusCode: response.statusCode, body: response.body },
            },
            attempt
          )
          this.recordSuccess(toolId)
          return
        }

        if (response.statusCode >= 500) {
          // Server-side failure: worth retrying.
          lastError = `Tool endpoint responded with HTTP ${response.statusCode}`
          lastTimedOut = false
        } else {
          // 4xx: the request itself is wrong; retrying cannot help.
          await this.finalize(
            executionId,
            startedAt,
            {
              status: ExecutionStatus.FAILED,
              output: { statusCode: response.statusCode, body: response.body },
              error: `Tool endpoint responded with HTTP ${response.statusCode}`,
            },
            attempt
          )
          this.recordFailure(toolId)
          return
        }
      } catch (error) {
        if (error instanceof ToolTransportError) {
          lastError = error.message
          lastTimedOut = error.timedOut
          if (!error.retryable) {
            await this.finalize(
              executionId,
              startedAt,
              { status: ExecutionStatus.FAILED, error: error.message },
              attempt
            )
            this.recordFailure(toolId)
            return
          }
        } else {
          lastError = error instanceof Error ? error.message : String(error)
          lastTimedOut = false
        }
      }

      logger.warn('[toolEngine] Attempt failed', {
        executionId,
        toolId,
        attempt,
        maxAttempts,
        error: lastError,
      })

      if (attempt < maxAttempts) {
        const backoffMs =
          this.RETRY_BACKOFF_MS[Math.min(attempt - 1, this.RETRY_BACKOFF_MS.length - 1)]
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }
    }

    await this.finalize(
      executionId,
      startedAt,
      {
        status: lastTimedOut ? ExecutionStatus.TIMEOUT : ExecutionStatus.FAILED,
        error: lastError,
      },
      maxAttempts
    )
    this.recordFailure(toolId)
  }

  /**
   * Resolve the tool's declared secrets and assemble the outbound
   * request. Secret values are substituted for `{{secret:NAME}}`
   * placeholders in the config URL and header values; only names listed
   * in the tool's `secrets` array resolve, and values never reach logs.
   */
  private async buildHttpRequest(
    tool: ToolDefinition,
    input: Record<string, unknown>,
    timeoutOverride?: number
  ): Promise<HttpToolRequest> {
    const config = (tool.config ?? {}) as HttpToolConfig
    if (typeof config.url !== 'string' || config.url.length === 0) {
      throw new ValidationException('Tool config is missing a "url"')
    }

    const declared = new Set(tool.secrets)
    const referenced = new Set<string>()
    const collect = (value: string): void => {
      for (const match of value.matchAll(SECRET_PLACEHOLDER)) {
        referenced.add(match[1])
      }
    }
    collect(config.url)
    const rawHeaders: Record<string, string> = {}
    if (config.headers && typeof config.headers === 'object') {
      for (const [key, value] of Object.entries(config.headers as Record<string, unknown>)) {
        if (typeof value === 'string') {
          rawHeaders[key.toLowerCase()] = value
          collect(value)
        }
      }
    }

    for (const name of referenced) {
      if (!declared.has(name)) {
        throw new ValidationException(
          `Tool config references secret "${name}" that is not declared in the tool's secrets list`
        )
      }
    }

    const secrets = referenced.size > 0
      ? await this.resolveToolSecrets(tool.id, [...referenced])
      : {}
    const substitute = (value: string): string =>
      value.replace(SECRET_PLACEHOLDER, (_whole, name: string) => secrets[name])

    const method =
      typeof config.method === 'string' && ALLOWED_METHODS.has(config.method.toUpperCase())
        ? config.method.toUpperCase()
        : 'POST'

    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(rawHeaders)) {
      headers[key] = substitute(value)
    }

    let url = substitute(config.url)
    let body: string | undefined
    if (method === 'GET' || method === 'HEAD') {
      const target = new URL(url)
      for (const [key, value] of Object.entries(input)) {
        target.searchParams.set(
          key,
          typeof value === 'string' ? value : JSON.stringify(value)
        )
      }
      url = target.toString()
    } else {
      body = JSON.stringify(input)
      if (!headers['content-type']) {
        headers['content-type'] = 'application/json'
      }
    }

    return {
      url,
      method,
      headers,
      body,
      timeoutMs: timeoutOverride ?? tool.timeout,
    }
  }

  private async finalize(
    executionId: string,
    startedAt: Date | null,
    result: TerminalResult,
    attemptNumber?: number
  ): Promise<void> {
    const completedAt = new Date()
    try {
      await prisma.toolExecution.update({
        where: { id: executionId },
        data: {
          status: result.status,
          output: result.output ? (result.output as InputJsonValue) : undefined,
          error: result.error ?? null,
          completedAt,
          duration: startedAt ? completedAt.getTime() - startedAt.getTime() : null,
          ...(attemptNumber !== undefined && { attemptNumber }),
        },
      })
    } catch (error) {
      logger.error('[toolEngine] Failed to record terminal execution state', {
        executionId,
        status: result.status,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Retrieve and decrypt the named tool secrets. Values are returned to
   * the caller for request assembly only — they are never logged and
   * never stored on the execution record.
   */
  async resolveToolSecrets(toolId: string, secretNames: string[]): Promise<Record<string, string>> {
    const { toolSecretService } = await import('./toolSecret.service')
    const secrets: Record<string, string> = {}

    for (const secretName of secretNames) {
      const result = await toolSecretService.getEncryptedSecretByToolAndName(toolId, secretName)
      if (!result) {
        logger.error('[toolEngine] Secret not found or expired', { toolId, secretName })
        throw new ValidationException(`Secret not found: ${secretName}`)
      }
      secrets[secretName] = result.decrypted
    }

    return secrets
  }

  /**
   * Per-tool circuit breaker: after a 50%+ failure rate the breaker
   * opens and executions fail fast for a minute instead of hammering a
   * broken endpoint through full retry budgets.
   */
  private getCircuitBreakerState(
    toolId: string
  ): { open: boolean; failureCount: number; successCount: number; lastFailure: Date } {
    let state = this.circuitBreakerState.get(toolId)

    if (!state) {
      state = { open: false, failureCount: 0, successCount: 0, lastFailure: new Date() }
      this.circuitBreakerState.set(toolId, state)
    }

    if (state.open && Date.now() - state.lastFailure.getTime() > this.CIRCUIT_BREAKER_TIMEOUT_MS) {
      state.open = false
      state.failureCount = 0
      state.successCount = 0
    }

    return state
  }

  private recordFailure(toolId: string): void {
    const state = this.getCircuitBreakerState(toolId)
    state.failureCount++
    state.lastFailure = new Date()

    const failureRate = state.failureCount / Math.max(1, state.failureCount + state.successCount)
    if (failureRate >= this.CIRCUIT_BREAKER_THRESHOLD) {
      state.open = true
      logger.warn('[toolEngine] Circuit breaker opened', { toolId, failureRate })
    }
  }

  private recordSuccess(toolId: string): void {
    const state = this.getCircuitBreakerState(toolId)
    state.successCount++

    if (state.open && state.successCount >= 5) {
      state.open = false
      state.failureCount = 0
      logger.info('[toolEngine] Circuit breaker closed', { toolId })
    }
  }
}

export const toolEngineService = new ToolEngineService()
