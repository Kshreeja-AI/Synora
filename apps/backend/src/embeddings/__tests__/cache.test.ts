import { describe, it, expect, vi } from 'vitest';
import { InMemoryEmbeddingCache, buildCacheKey } from '../cache';
import { EmbeddingResult } from '../types';

function makeResult(values: number[]): EmbeddingResult {
  return {
    embedding: { values, dimensions: values.length },
    provider: 'openai',
    model: 'text-embedding-3-small',
    usage: { tokens: 5 },
    cached: false,
  };
}

describe('buildCacheKey', () => {
  it('produces different keys for different workspaces (workspace isolation)', () => {
    const keyA = buildCacheKey('workspace-a', 'openai', 'text-embedding-3-small', 'same text');
    const keyB = buildCacheKey('workspace-b', 'openai', 'text-embedding-3-small', 'same text');
    expect(keyA).not.toBe(keyB);
  });

  it('produces the same key for identical (workspace, provider, model, text)', () => {
    const keyA = buildCacheKey('ws-1', 'openai', 'model-x', 'hello');
    const keyB = buildCacheKey('ws-1', 'openai', 'model-x', 'hello');
    expect(keyA).toBe(keyB);
  });

  it('produces different keys for different text content', () => {
    const keyA = buildCacheKey('ws-1', 'openai', 'model-x', 'hello');
    const keyB = buildCacheKey('ws-1', 'openai', 'model-x', 'goodbye');
    expect(keyA).not.toBe(keyB);
  });

  it('produces different keys for different models', () => {
    const keyA = buildCacheKey('ws-1', 'openai', 'model-x', 'hello');
    const keyB = buildCacheKey('ws-1', 'openai', 'model-y', 'hello');
    expect(keyA).not.toBe(keyB);
  });
});

describe('InMemoryEmbeddingCache', () => {
  it('returns null on a miss', async () => {
    const cache = new InMemoryEmbeddingCache(10);
    expect(await cache.get('missing-key')).toBeNull();
  });

  it('returns a stored entry on a hit', async () => {
    const cache = new InMemoryEmbeddingCache(10);
    const result = makeResult([1, 2, 3]);
    await cache.set('key-1', { result, createdAt: Date.now() }, 60_000);

    const entry = await cache.get('key-1');
    expect(entry?.result.embedding.values).toEqual([1, 2, 3]);
  });

  it('expires entries after their TTL', async () => {
    vi.useFakeTimers();
    const cache = new InMemoryEmbeddingCache(10);
    await cache.set('key-1', { result: makeResult([1]), createdAt: Date.now() }, 1000);

    vi.advanceTimersByTime(1001);

    expect(await cache.get('key-1')).toBeNull();
    vi.useRealTimers();
  });

  it('evicts the oldest entry once maxEntries is exceeded', async () => {
    const cache = new InMemoryEmbeddingCache(2);
    await cache.set('key-1', { result: makeResult([1]), createdAt: Date.now() }, 60_000);
    await cache.set('key-2', { result: makeResult([2]), createdAt: Date.now() }, 60_000);
    await cache.set('key-3', { result: makeResult([3]), createdAt: Date.now() }, 60_000);

    expect(await cache.get('key-1')).toBeNull();
    expect(await cache.get('key-2')).not.toBeNull();
    expect(await cache.get('key-3')).not.toBeNull();
  });

  it('clears all entries', async () => {
    const cache = new InMemoryEmbeddingCache(10);
    await cache.set('key-1', { result: makeResult([1]), createdAt: Date.now() }, 60_000);
    await cache.clear();
    expect(await cache.size()).toBe(0);
  });

  it('reports its current size', async () => {
    const cache = new InMemoryEmbeddingCache(10);
    await cache.set('key-1', { result: makeResult([1]), createdAt: Date.now() }, 60_000);
    await cache.set('key-2', { result: makeResult([2]), createdAt: Date.now() }, 60_000);
    expect(await cache.size()).toBe(2);
  });
});
