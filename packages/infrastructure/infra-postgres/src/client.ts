import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export interface PostgresClientOptions {
  connectionString: string;
  maxConnections?: number;
}

export type PostgresDatabase = ReturnType<typeof drizzle>;

export interface PostgresClient {
  readonly pool: Pool;
  readonly db: PostgresDatabase;
  close(): Promise<void>;
}

export function createPostgresClient(options: PostgresClientOptions): PostgresClient {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
  });
  const db = drizzle(pool);

  return {
    pool,
    db,
    close: () => pool.end(),
  };
}
