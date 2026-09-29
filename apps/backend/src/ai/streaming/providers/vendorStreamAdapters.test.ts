/**
 * The vendor stream adapters rebased onto the shared OpenAI-compatible
 * implementation. The inheritance IS the behavioural guarantee — every
 * wire behaviour (SSE ordering, usage accounting, auth header, error
 * mapping) is pinned once in openaiCompatible.test.ts and inherited here —
 * so what this file pins is exactly what each vendor file still owns: its
 * name, and where its credential comes from.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleStreamProvider } from './openaiCompatible';
import { TextGenerationStreamProvider } from '../types';
import { DeepSeekStreamProvider } from './deepseek';
import { OpenRouterStreamProvider } from './openrouter';
import { GroqStreamProvider } from './groq';

interface VendorCase {
  id: string;
  envVar: string;
  make: (apiKey?: string) => TextGenerationStreamProvider;
}

const VENDORS: VendorCase[] = [
  {
    id: 'deepseek',
    envVar: 'DEEPSEEK_API_KEY',
    make: (apiKey) => new DeepSeekStreamProvider(apiKey),
  },
  {
    id: 'openrouter',
    envVar: 'OPENROUTER_API_KEY',
    make: (apiKey) => new OpenRouterStreamProvider(apiKey),
  },
  {
    id: 'groq',
    envVar: 'GROQ_API_KEY',
    make: (apiKey) => new GroqStreamProvider(apiKey),
  },
];

describe.each(VENDORS)('$id stream adapter', ({ id, envVar, make }) => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[envVar];
    delete process.env[envVar];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[envVar];
    else process.env[envVar] = savedEnv;
  });

  it('is the shared OpenAI-compatible implementation under the vendor name', () => {
    const provider = make('k');
    // Inheritance carries every wire test in openaiCompatible.test.ts; a
    // vendor file that reimplements the body escapes all of them.
    expect(provider).toBeInstanceOf(OpenAICompatibleStreamProvider);
    expect(provider.getName()).toBe(id);
  });

  it('is not configured with neither a constructor key nor the env var', () => {
    expect(make().isConfigured()).toBe(false);
  });

  it('is configured via an explicit constructor key', () => {
    expect(make('explicit-key').isConfigured()).toBe(true);
  });

  it('observes the env var lazily — a key set after construction is seen', () => {
    const provider = make();
    expect(provider.isConfigured()).toBe(false);
    // The copies this replaced froze `configured` at construction; the
    // rebased adapters answer from the environment as it is NOW.
    process.env[envVar] = 'set-after-construction';
    expect(provider.isConfigured()).toBe(true);
    delete process.env[envVar];
    expect(provider.isConfigured()).toBe(false);
  });
});
