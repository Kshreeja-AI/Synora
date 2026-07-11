import { Redis } from 'ioredis';

export interface RedisClientOptions {
  url: string;
  /** Defaults to true — connects lazily on first command instead of at construction time. */
  lazyConnect?: boolean;
}

export function createRedisClient(options: RedisClientOptions): Redis {
  return new Redis(options.url, { lazyConnect: options.lazyConnect ?? true });
}
