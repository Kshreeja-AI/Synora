/**
 * A generated placeholder must never make a provider claim it is
 * configured.
 *
 * In development/testing the secrets chain deliberately ends in
 * PlaceholderSecretSource, which manufactures a value for ANY key so the
 * app boots with zero real secrets. Before this slice, every provider
 * descriptor implemented isConfigured() as "tryGet() returned something" —
 * which in those stages is ALWAYS true. The capabilities report showed
 * providers as active with no credentials anywhere, and resolution would
 * select a real vendor and call it with `placeholder_…`, turning an honest
 * "not configured" into a misleading vendor auth failure.
 *
 * These tests run against the REAL secrets manager singleton in the
 * testing stage — exactly the environment where the lie lived — with no
 * mocks, so they fail on the old tryGet()-based implementations.
 *
 * One caution for future edits: the secrets manager caches the first
 * resolution per key for the life of the process, so each assertion below
 * uses a key no other assertion (or module import) has touched, and env
 * mutation happens before the first read of that key.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { anthropicDescriptor } from '../providers/anthropic.provider';
import { togetherDescriptor } from '../providers/together.provider';
import { voyageEmbeddingDescriptor } from '../../embeddings/providers/voyage.provider';

const previousAnthropic = process.env.ANTHROPIC_API_KEY;
const previousTogether = process.env.TOGETHER_API_KEY;
const previousVoyage = process.env.VOYAGE_API_KEY;

beforeAll(() => {
  // Guarantee the placeholder path for the "unconfigured" keys even if the
  // ambient shell happens to export them.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  // And a real (env-provided, non-placeholder) value for the positive case.
  process.env.TOGETHER_API_KEY = 'together-key-not-real';
});

afterAll(() => {
  if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previousAnthropic;
  if (previousTogether === undefined) delete process.env.TOGETHER_API_KEY;
  else process.env.TOGETHER_API_KEY = previousTogether;
  if (previousVoyage === undefined) delete process.env.VOYAGE_API_KEY;
  else process.env.VOYAGE_API_KEY = previousVoyage;
});

describe('provider credential honesty', () => {
  it('an AI provider whose key resolves only to a placeholder is NOT configured', async () => {
    await expect(anthropicDescriptor.isConfigured()).resolves.toBe(false);
  });

  it('an embeddings provider whose key resolves only to a placeholder is NOT configured', async () => {
    await expect(voyageEmbeddingDescriptor.isConfigured()).resolves.toBe(false);
  });

  it('a provider with a real env-provided key IS configured', async () => {
    // The distinction is provenance, not value shape: this key is fake to
    // the vendor too, but a person put it in the environment, so the
    // platform must treat it as configuration — exactly how
    // ai/resolver.test.ts has always exercised real resolution.
    await expect(togetherDescriptor.isConfigured()).resolves.toBe(true);
  });
});
