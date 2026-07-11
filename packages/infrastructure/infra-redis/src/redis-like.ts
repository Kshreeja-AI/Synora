/**
 * The minimal subset of the ioredis client both adapters need. Depending on this instead
 * of the concrete `Redis` class lets tests inject a fast in-memory fake.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  lpush(key: string, value: string): Promise<number>;
  rpop(key: string): Promise<string | null>;
}
