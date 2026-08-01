import type { ApiEnvelope, ApiErrorBody } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the 401-refresh-retry cycle (for auth endpoints themselves). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

// Single-flight refresh: concurrent 401s share one refresh request to avoid
// presenting the single-use rotating refresh token twice.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // Send refreshToken cookie automatically
    });
    // Tokens are in HttpOnly cookies set by backend; no need to store them
    return response.ok;
  } catch {
    return false;
  }
}

function ensureRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshTokens().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  // FormData must never get a Content-Type header set manually — the
  // browser needs to add the multipart boundary itself.
  if (options.body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
  return fetch(`${getApiBaseUrl()}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include', // Send accessToken cookie automatically
    body: isFormData ? (options.body as FormData) : options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  let envelope: ApiEnvelope<T> | undefined;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // Non-JSON body (proxy error page, empty body) — fall through.
  }

  if (!response.ok || !envelope?.success) {
    throw new ApiError(
      response.status,
      envelope?.error ?? { message: `Request failed with status ${response.status}` }
    );
  }
  return envelope.data as T;
}

/**
 * Typed request against the backend API. Tokens are in HttpOnly cookies sent automatically.
 * On a 401 transparently refreshes the session (single-flight) and retries the request once.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawRequest(path, options);

  if (response.status === 401 && !options.anonymous) {
    const refreshed = await ensureRefresh();
    if (refreshed) {
      response = await rawRequest(path, options);
    }
  }

  return parseEnvelope<T>(response);
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>
  ): Promise<T> => apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>
  ): Promise<T> => apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>
  ): Promise<T> => apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>
  ): Promise<T> => apiRequest<T>(path, { ...options, method: 'DELETE', body }),
  /** Multipart upload (e.g. avatar) — same auth/refresh-retry handling as every other method. */
  upload: <T>(
    path: string,
    formData: FormData,
    options?: Omit<RequestOptions, 'method' | 'body'>
  ): Promise<T> => apiRequest<T>(path, { ...options, method: 'POST', body: formData }),
};
