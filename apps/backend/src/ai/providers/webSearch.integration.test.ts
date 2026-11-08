/**
 * LIVE integration test against Wikipedia's public API. Opt-in so the normal
 * suite stays offline and deterministic:  SYNORA_LIVE_TESTS=1 pnpm vitest run <this file>
 * When not enabled it is SKIPPED — which is reported as not-run, never as a pass.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config', () => ({ getConfig: vi.fn() }));

import { WikipediaSearchProvider } from './webSearch.providers';

const live = process.env.SYNORA_LIVE_TESTS === '1';

describe.skipIf(!live)('Wikipedia search (live network)', () => {
  it('returns real, citable English results', async () => {
    const out = await new WikipediaSearchProvider().search({ query: 'Taj Mahal', limit: 3 });
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results[0].url).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
  }, 20_000);

  it('returns results from the Hindi edition', async () => {
    const out = await new WikipediaSearchProvider().search({ query: 'ताजमहल', language: 'hi', limit: 3 });
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results[0].url).toMatch(/^https:\/\/hi\.wikipedia\.org\/wiki\//);
  }, 20_000);
});
