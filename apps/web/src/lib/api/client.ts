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

/**
 * The API's own absolute address. Use it only for a URL that is handed to
 * something OUTSIDE this browser session — a webhook address a person
 * pastes into another service — where "relative to this page" means nothing.
 */
export function getPublicApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

/**
 * The base every request is made against.
 *
 * IN THE BROWSER THIS IS EMPTY, so requests go to the page's own origin and
 * `next.config.js` proxies `/api/*` on to the backend. That is deliberate:
 * the session and CSRF cookies are `SameSite=Strict`, and the website and
 * the API are deployed on different sites. A browser will neither send
 * those cookies to another site nor let the page read the CSRF one, so a
 * direct cross-site call can register and log in and then do nothing else.
 * Same-origin requests make the cookies first-party again without weakening
 * a single cookie attribute.
 *
 * On the server there is no page origin to be relative to, so server-side
 * code talks to the API directly.
 */
export function getApiBaseUrl(): string {
  return typeof window === 'undefined' ? getPublicApiUrl() : '';
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

const CSRF_COOKIE = 'X-CSRF-Token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The CSRF token the backend set on a previous safe request.
 *
 * The backend uses double-submit: it will only accept a mutating request
 * that echoes this cookie back in a header, proving the caller is
 * same-origin script rather than a cross-site page that can make the
 * browser SEND cookies but never read them.
 *
 * This half did not exist. The backend demanded the header on every
 * mutating route outside /api/auth and nothing ever sent one, so a real
 * user could register, log in, and then not create a workspace, start a
 * conversation, or send a single message — all 403.
 */
function readCsrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  // FormData must never get a Content-Type header set manually — the
  // browser needs to add the multipart boundary itself.
  if (options.body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';

  const method = options.method ?? 'GET';
  if (MUTATING_METHODS.has(method)) {
    // Absent rather than empty when there is no token yet: sending a blank
    // header would fail the comparison with a confusing "validation failed"
    // instead of the accurate "make a GET request first".
    const csrf = readCsrfToken();
    if (csrf) headers[CSRF_COOKIE] = csrf;
  }

  return fetch(`${getApiBaseUrl()}${path}`, {
    method,
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
