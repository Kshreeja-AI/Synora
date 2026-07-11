import { AppError } from './app-error.js';

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 400;
  readonly isOperational = true;

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
  readonly isOperational = true;

  constructor(message: string) {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT';
  readonly httpStatus = 409;
  readonly isOperational = true;

  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends AppError {
  readonly code = 'UNAUTHORIZED';
  readonly httpStatus = 401;
  readonly isOperational = true;

  constructor(message: string) {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  readonly isOperational = true;

  constructor(message: string) {
    super(message);
  }
}

/** Wraps an unexpected failure from an infrastructure adapter (DB, cache, external API, ...). */
export class InfrastructureError extends AppError {
  readonly code = 'INFRASTRUCTURE_ERROR';
  readonly httpStatus = 502;
  readonly isOperational = false;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
