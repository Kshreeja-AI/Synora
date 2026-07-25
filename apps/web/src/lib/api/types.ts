/** Response envelope produced by the backend (`createApiResponse` / errorHandler). */
export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: ApiErrorBody;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  code?: string;
  message: string;
  details?: unknown;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type AuthResponse = AuthTokens & { user: AuthUser };
