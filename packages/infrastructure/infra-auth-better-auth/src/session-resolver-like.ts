/**
 * The minimal surface adapted from a configured `better-auth` instance. Deliberately not
 * the full better-auth API — keeps this adapter (and its tests) decoupled from
 * better-auth's exact instance shape/version.
 */
export interface ResolvedSession {
  userId: string;
  claims?: Record<string, unknown>;
}

export interface SessionResolverLike {
  resolveSession(sessionToken: string): Promise<ResolvedSession | null>;
}
