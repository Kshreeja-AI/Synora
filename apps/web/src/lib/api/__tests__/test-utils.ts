import { vi } from 'vitest';
import type { ApiEnvelope } from '../types';

/**
 * Mock fetch to return properly formatted ApiEnvelope responses.
 * This ensures tests properly simulate the actual API behavior.
 */
export function createApiMock<T>(data: T, options?: { status?: number; error?: unknown }) {
  return vi.fn().mockResolvedValue({
    ok: options?.status ? options.status >= 200 && options.status < 300 : true,
    status: options?.status ?? 200,
    json: vi.fn().mockResolvedValue({
      success: !options?.error,
      data: options?.error ? undefined : data,
      error: options?.error ?? undefined,
    } as ApiEnvelope<T>),
  });
}

/**
 * Create a mock Response object for successful API responses.
 */
export function createSuccessResponse<T>(data: T): Response {
  const envelope: ApiEnvelope<T> = {
    success: true,
    data,
  };

  return {
    ok: true,
    status: 200,
    json: async () => envelope,
  } as unknown as Response;
}

/**
 * Create a mock Response object for error responses.
 */
export function createErrorResponse(message: string, status = 400): Response {
  const envelope: ApiEnvelope<never> = {
    success: false,
    error: {
      message,
      code: 'API_ERROR',
    },
  };

  return {
    ok: false,
    status,
    json: async () => envelope,
  } as unknown as Response;
}
