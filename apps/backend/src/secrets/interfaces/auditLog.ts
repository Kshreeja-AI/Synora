import { SecretSourceKind } from '../types';

export type SecretAuditAction =
  | 'read'
  | 'create'
  | 'rotate'
  | 'access-placeholder'
  | 'access-expired'
  | 'access-denied';

/**
 * Deliberately has no `value` field. This is enforced by the type, not
 * just convention — there is no way to hand a secret's value to an audit
 * sink through this interface.
 */
export interface SecretAuditEvent {
  timestamp: Date;
  key: string;
  action: SecretAuditAction;
  source: SecretSourceKind;
  version?: number;
  /** Logical caller, e.g. "backend:auth-middleware" — never a person unless the caller is a human-operated CLI. */
  actor: string;
  metadata?: Record<string, unknown>;
}

export interface ISecretAuditLog {
  record(event: SecretAuditEvent): void;
}
