import type { Principal } from '@synora/core';
import { describe, expect, it } from 'vitest';
import { ApiKeyAuthenticator, requireScope } from './api-key-auth.js';

describe('ApiKeyAuthenticator', () => {
  const auth = new ApiKeyAuthenticator([
    { keyId: 'dev-key', secret: 'dev-secret', scopes: ['agent:invoke'], tenantId: 'acme' },
  ]);

  it('authenticates a valid credential', () => {
    const principal = auth.authenticate('dev-key.dev-secret');
    expect(principal.tenantId).toBe('acme');
    expect(principal.scopes).toEqual(['agent:invoke']);
  });

  it('rejects an unknown key id', () => {
    expect(() => auth.authenticate('nope.dev-secret')).toThrow(/Invalid API credential/);
  });

  it('rejects a wrong secret', () => {
    expect(() => auth.authenticate('dev-key.wrong')).toThrow(/Invalid API credential/);
  });

  it('rejects a malformed credential', () => {
    expect(() => auth.authenticate('not-a-valid-format')).toThrow(/Malformed API credential/);
  });
});

describe('requireScope', () => {
  it('allows admin principals through any scope check', () => {
    const principal: Principal = {
      tenantId: 'acme' as never,
      userId: 'u1' as never,
      scopes: ['admin'],
    };
    expect(() => requireScope(principal, 'memory:write')).not.toThrow();
  });

  it('throws when the scope is missing', () => {
    const principal: Principal = {
      tenantId: 'acme' as never,
      userId: 'u1' as never,
      scopes: ['agent:invoke'],
    };
    expect(() => requireScope(principal, 'memory:write')).toThrow(/Missing required scope/);
  });
});
