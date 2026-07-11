import { InfrastructureError } from '@synora/errors';
import { describe, expect, it } from 'vitest';
import { mapPostgresError } from './map-postgres-error.js';

describe('mapPostgresError', () => {
  it('wraps a driver error into an InfrastructureError carrying the cause', () => {
    const driverError = new Error('duplicate key value violates unique constraint');
    const mapped = mapPostgresError(driverError);

    expect(mapped).toBeInstanceOf(InfrastructureError);
    expect(mapped.message).toContain('duplicate key value');
    expect(mapped.cause).toBe(driverError);
  });
});
