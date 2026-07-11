import { timingSafeEqual } from 'node:crypto';
import { type Principal, type Scope, UnauthorizedError, asTenantId, asUserId } from '@synora/core';

export interface ApiKeyRecord {
  keyId: string;
  secret: string;
  scopes: Scope[];
  tenantId?: string;
  userId?: string;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Resolves a raw "keyId.secret" bearer credential to a Principal.
 * Comparison is constant-time to avoid leaking secret material through
 * response-time side channels. Swap for a database/KMS-backed lookup
 * in production; the AuthContext shape callers depend on is unchanged.
 */
export class ApiKeyAuthenticator {
  private readonly byKeyId = new Map<string, ApiKeyRecord>();

  constructor(records: ApiKeyRecord[]) {
    for (const record of records) this.byKeyId.set(record.keyId, record);
  }

  authenticate(rawCredential: string): Principal {
    const [keyId, secret] = rawCredential.split('.', 2);
    if (!keyId || !secret) {
      throw new UnauthorizedError('Malformed API credential; expected "<keyId>.<secret>"');
    }
    const record = this.byKeyId.get(keyId);
    if (!record || !safeCompare(record.secret, secret)) {
      throw new UnauthorizedError('Invalid API credential');
    }
    return {
      tenantId: asTenantId(record.tenantId ?? 'default'),
      userId: asUserId(record.userId ?? record.keyId),
      scopes: record.scopes,
      keyId: record.keyId,
    };
  }
}

export function requireScope(principal: Principal, scope: Scope): void {
  if (principal.scopes.includes('admin')) return;
  if (!principal.scopes.includes(scope)) {
    throw new UnauthorizedError(`Missing required scope "${scope}"`);
  }
}
