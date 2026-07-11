import { describe, expect, it } from 'vitest';
import { FakeRedis } from './fake-redis.test-helper.js';
import { RedisCache } from './redis-cache.js';

describe('RedisCache', () => {
  it('round-trips JSON-serializable values', async () => {
    const cache = new RedisCache(new FakeRedis());
    await cache.set('user:1', { name: 'Ada' });
    expect(await cache.get('user:1')).toEqual({ name: 'Ada' });
  });

  it('returns undefined for a missing key', async () => {
    const cache = new RedisCache(new FakeRedis());
    expect(await cache.get('missing')).toBeUndefined();
  });

  it('delete removes the key', async () => {
    const cache = new RedisCache(new FakeRedis());
    await cache.set('key', 'value');
    await cache.delete('key');
    expect(await cache.get('key')).toBeUndefined();
  });
});
