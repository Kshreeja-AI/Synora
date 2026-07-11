import { describe, expect, it } from 'vitest';
import { BetterAuthProvider } from './better-auth-provider.js';
import type { SessionResolverLike } from './session-resolver-like.js';

describe('BetterAuthProvider', () => {
  it('maps a resolved session to an AuthSession', async () => {
    const resolver: SessionResolverLike = {
      resolveSession: async () => ({ userId: 'user-1', claims: { role: 'admin' } }),
    };
    const provider = new BetterAuthProvider(resolver);

    expect(await provider.verifySession('token')).toEqual({
      userId: 'user-1',
      claims: { role: 'admin' },
    });
  });

  it('returns undefined for an invalid session token', async () => {
    const resolver: SessionResolverLike = { resolveSession: async () => null };
    const provider = new BetterAuthProvider(resolver);

    expect(await provider.verifySession('bad-token')).toBeUndefined();
  });
});
