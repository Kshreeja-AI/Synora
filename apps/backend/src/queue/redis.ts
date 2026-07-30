import Redis, { RedisOptions } from 'ioredis';
import { logger } from '../utils/logger';

interface RedisConnectionConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  tls?: boolean;
  maxRetriesPerRequest?: number;
  enableReadyCheck?: boolean;
  enableOfflineQueue?: boolean;
}

class RedisConnectionManager {
  private connection: Redis | null = null;
  private config: RedisConnectionConfig;

  constructor(config: RedisConnectionConfig = {}) {
    this.config = config;
  }

  connect(): Redis {
    if (this.connection) {
      return this.connection;
    }

    if (this.config.url) {
      this.connection = new Redis(this.config.url);
    } else {
      const options = this.buildRedisOptions() as RedisOptions;
      this.connection = new Redis(options);
    }

    this.connection.on('connect', () => {
      logger.info('[Redis] Connected to Redis', {
        host: this.config.host || 'localhost',
        port: this.config.port || 6379,
      });
    });

    this.connection.on('error', (err: NodeJS.ErrnoException) => {
      logger.error('[Redis] Redis error', {
        error: err.message,
        code: err.code,
      });
    });

    this.connection.on('reconnecting', () => {
      logger.warn('[Redis] Reconnecting to Redis');
    });

    this.connection.on('close', () => {
      logger.info('[Redis] Redis connection closed');
    });

    return this.connection;
  }

  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.connection) {
        resolve();
        return;
      }

      this.connection.quit(() => {
        this.connection = null;
        logger.info('[Redis] Disconnected from Redis');
        resolve();
      });
    });
  }

  getConnection(): Redis {
    if (!this.connection) {
      return this.connect();
    }
    return this.connection;
  }

  async ping(): Promise<boolean> {
    try {
      const conn = this.getConnection();
      const result = await conn.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('[Redis] Ping failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private buildRedisOptions(): RedisOptions {
    return {
      host: this.config.host || 'localhost',
      port: this.config.port || 6379,
      password: this.config.password,
      db: this.config.db || 0,
      tls: this.config.tls ? {} : undefined,
      maxRetriesPerRequest: this.config.maxRetriesPerRequest ?? null,
      enableReadyCheck: this.config.enableReadyCheck ?? true,
      enableOfflineQueue: this.config.enableOfflineQueue ?? true,
    };
  }
}

let redisManager: RedisConnectionManager | null = null;

export function initRedis(config: RedisConnectionConfig = {}): RedisConnectionManager {
  if (!redisManager) {
    redisManager = new RedisConnectionManager(config);
  }
  return redisManager;
}

export function getRedis(): RedisConnectionManager {
  if (!redisManager) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return redisManager;
}

export function getRedisConnection(): Redis {
  return getRedis().getConnection();
}

export function resetRedisForTests(): void {
  redisManager = null;
}
