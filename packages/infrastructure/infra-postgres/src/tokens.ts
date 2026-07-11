import { createToken } from '@synora/di';
import type { PostgresDatabase } from './client.js';

/** DI token for the shared Postgres database handle — bound once in the composition root. */
export const POSTGRES_DATABASE = createToken<PostgresDatabase>('PostgresDatabase');
