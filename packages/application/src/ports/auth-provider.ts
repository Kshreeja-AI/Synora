/** Port for authentication/session verification (default provider: better-auth — see infra-auth-better-auth). */
export interface AuthSession {
  readonly userId: string;
  readonly claims: Readonly<Record<string, unknown>>;
}

export interface AuthProvider {
  verifySession(sessionToken: string): Promise<AuthSession | undefined>;
}
