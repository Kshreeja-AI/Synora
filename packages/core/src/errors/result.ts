/**
 * A minimal Result type so ports can express expected failure modes
 * (rate limits, invalid tool input, provider errors) without throwing
 * across module boundaries. Reserve exceptions for truly exceptional,
 * unrecoverable states.
 */
export type Result<T, E = SynoraError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export class SynoraError extends Error {
  readonly code: string;
  override readonly cause?: unknown;
  readonly retryable: boolean;

  constructor(code: string, message: string, options?: { cause?: unknown; retryable?: boolean }) {
    super(message);
    this.name = 'SynoraError';
    this.code = code;
    this.cause = options?.cause;
    this.retryable = options?.retryable ?? false;
  }
}

export class ProviderError extends SynoraError {
  constructor(message: string, options?: { cause?: unknown; retryable?: boolean }) {
    super('PROVIDER_ERROR', message, options);
    this.name = 'ProviderError';
  }
}

export class ToolExecutionError extends SynoraError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('TOOL_EXECUTION_ERROR', message, options);
    this.name = 'ToolExecutionError';
  }
}

export class GuardrailViolationError extends SynoraError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('GUARDRAIL_VIOLATION', message, options);
    this.name = 'GuardrailViolationError';
  }
}

export class NotFoundError extends SynoraError {
  constructor(message: string) {
    super('NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends SynoraError {
  constructor(message: string) {
    super('UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}
