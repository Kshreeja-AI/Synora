import type { AuthProvider, AuthSession } from '@synora/application';
import type { SessionResolverLike } from './session-resolver-like.js';

export class BetterAuthProvider implements AuthProvider {
  constructor(private readonly resolver: SessionResolverLike) {}

  async verifySession(sessionToken: string): Promise<AuthSession | undefined> {
    const resolved = await this.resolver.resolveSession(sessionToken);
    if (!resolved) return undefined;
    return { userId: resolved.userId, claims: resolved.claims ?? {} };
  }
}
