/**
 * Credential verification — the contract that has to hold on the day real
 * keys are first connected.
 *
 * These tests contact NO provider. They prove Synora's own classification
 * logic: that a refusal, a network failure, an unverifiable provider and a
 * success are four distinguishable outcomes, and that no one of them is
 * ever quietly reported as another.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyProvider } from '../verification';
import type { AIProviderDescriptor } from '../types/descriptor';

function descriptor(overrides: Partial<AIProviderDescriptor> = {}): AIProviderDescriptor {
  return {
    id: 'test-provider',
    displayName: 'Test Provider',
    capabilities: ['text-generation'],
    isConfigured: async () => true,
    create: async () => {
      throw new Error('not used in these tests');
    },
    ...overrides,
  } as AIProviderDescriptor;
}

/** Mirrors how the official SDKs surface an HTTP status on their errors. */
function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

beforeEach(() => vi.clearAllMocks());

describe('verifyProvider', () => {
  it('reports a provider that accepts the credential as verified', async () => {
    const result = await verifyProvider(
      descriptor({
        verifyCredential: async () => ({ status: 'verified', detail: 'accepted' }),
      }),
    );
    expect(result.status).toBe('verified');
  });

  it('reports a refused credential as rejected, not as a network problem', async () => {
    for (const status of [401, 403]) {
      const result = await verifyProvider(
        descriptor({
          verifyCredential: async () => {
            throw httpError(status);
          },
        }),
      );
      // The provider answered. This is a definite verdict on the key, and
      // the operator should go fix the key.
      expect(result.status).toBe('rejected');
      expect(result.detail).toMatch(new RegExp(String(status)));
    }
  });

  it('reports a network failure as unreachable, and says it proves nothing', async () => {
    const result = await verifyProvider(
      descriptor({
        verifyCredential: async () => {
          throw new Error('ETIMEDOUT');
        },
      }),
    );
    // Calling this "rejected" would send someone hunting a credential
    // problem that does not exist.
    expect(result.status).toBe('unreachable');
    expect(result.detail).toMatch(/says nothing about whether the credential is valid/i);
  });

  it('treats a 500 as unreachable — an outage is not a verdict on the key', async () => {
    const result = await verifyProvider(
      descriptor({
        verifyCredential: async () => {
          throw httpError(500);
        },
      }),
    );
    expect(result.status).toBe('unreachable');
  });

  it('treats a 429 as unreachable — being rate limited is not being refused', async () => {
    const result = await verifyProvider(
      descriptor({
        verifyCredential: async () => {
          throw httpError(429);
        },
      }),
    );
    expect(result.status).toBe('unreachable');
  });

  it('admits when a provider offers no cheap check, rather than implying it passed', async () => {
    const result = await verifyProvider(descriptor({ verifyCredential: undefined }));
    // Honest ignorance. A provider with no verification method must never
    // be reported as verified — that would be a passing grade nobody earned.
    expect(result.status).toBe('not-verifiable');
    expect(result.status).not.toBe('verified');
  });

  it('never throws, because it is run precisely when things are broken', async () => {
    await expect(
      verifyProvider(
        descriptor({
          verifyCredential: async () => {
            throw new Error('total collapse');
          },
        }),
      ),
    ).resolves.toMatchObject({ status: 'unreachable' });
  });
});
