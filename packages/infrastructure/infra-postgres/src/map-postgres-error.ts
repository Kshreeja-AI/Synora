import { InfrastructureError } from '@synora/errors';

interface PgDriverError {
  code?: string;
  message?: string;
}

/** Translates a raw `pg` driver error into an InfrastructureError so it never crosses the layer boundary as-is. */
export function mapPostgresError(error: unknown): InfrastructureError {
  const driverError = error as PgDriverError;
  const message = driverError?.message ?? 'Unknown Postgres error';
  return new InfrastructureError(`Postgres error: ${message}`, { cause: error });
}
