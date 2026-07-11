import { AppError } from '@synora/errors';
import type { HttpResponse } from '@synora/plugin-system';
import type { ApiResponse } from '@synora/types';

/**
 * Maps any thrown error to an HttpResponse using the ApiResponse envelope. AppErrors carry
 * their own httpStatus/code; anything else is an unexpected failure — respond generically
 * and let the caller's logger capture the real error. See
 * docs/architecture/13-error-handling-standards.md.
 */
export function toErrorResponse(error: unknown): HttpResponse {
  if (error instanceof AppError) {
    const body: ApiResponse<never> = {
      success: false,
      error: { code: error.code, message: error.isOperational ? error.message : 'Internal error' },
    };
    return { status: error.httpStatus, body };
  }

  const body: ApiResponse<never> = {
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal error' },
  };
  return { status: 500, body };
}

export function toSuccessResponse<T>(data: T, status = 200): HttpResponse {
  const body: ApiResponse<T> = { success: true, data };
  return { status, body };
}
