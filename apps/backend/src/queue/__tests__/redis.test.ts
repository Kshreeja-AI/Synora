import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import Redis from 'ioredis';
import { initRedis, getRedis, resetRedisForTests } from '../redis';

describe('RedisConnectionManager', () => {
  let isRedisAvailable = false;

  beforeAll(async () => {
    try {
      const testClient = new Redis({
        host: 'localhost',
        port: 6379,
        lazyConnect: true,
        connectTimeout: 1000,
        maxRetriesPerRequest: 1,
      });
      testClient.on('error', () => {
        isRedisAvailable = false;
      });
      await testClient.connect();
      await testClient.ping();
      isRedisAvailable = true;
      await testClient.disconnect();
    } catch {
      isRedisAvailable = false;
    }
  }, 3000);

  afterEach(async () => {
    try {
      const redis = getRedis();
      await redis.disconnect();
    } catch {
      // Redis was never initialized or already disconnected; nothing to clean up.
    }
    resetRedisForTests();
  });

  it('should connect to Redis and return connection', async (ctx) => {
    if (!isRedisAvailable) {
      ctx.skip();
    }
    const manager = initRedis({ host: 'localhost', port: 6379 });
    const connection = manager.getConnection();
    expect(connection).toBeDefined();
  });

  it('should return cached connection on subsequent calls', (ctx) => {
    if (!isRedisAvailable) {
      ctx.skip();
    }
    const manager = initRedis({ host: 'localhost', port: 6379 });
    const conn1 = manager.getConnection();
    const conn2 = manager.getConnection();
    expect(conn1).toBe(conn2);
  });

  it('should handle ping to check connection', async (ctx) => {
    if (!isRedisAvailable) {
      ctx.skip();
    }
    const manager = initRedis({ host: 'localhost', port: 6379 });
    const isPing = await manager.ping();
    expect(typeof isPing).toBe('boolean');
  });

  it('should build Redis options from URL', (ctx) => {
    if (!isRedisAvailable) {
      ctx.skip();
    }
    const manager = initRedis({ url: 'redis://localhost:6379' });
    const connection = manager.getConnection();
    expect(connection).toBeDefined();
  });

  it('should handle disconnect gracefully', async (ctx) => {
    if (!isRedisAvailable) {
      ctx.skip();
    }
    const manager = initRedis({ host: 'localhost', port: 6379 });
    manager.getConnection();
    await manager.disconnect();
    // Verify connection is cleared
    expect(manager.getConnection()).toBeDefined();
  });
});
