import { ISecretAuditLog, SecretAuditEvent } from '../interfaces/auditLog';
import { logger } from '../../utils/logger';

const WARN_ACTIONS = new Set(['access-placeholder', 'access-expired', 'access-denied']);

/**
 * Default audit sink: structured winston logs. SecretAuditEvent has no
 * `value` field by construction, so there is nothing here that could leak
 * a secret even by mistake — this class just forwards the event's
 * metadata fields.
 *
 * For a real deployment, point this at a SIEM/append-only store instead
 * (implement ISecretAuditLog and swap it in) — local log files are not an
 * acceptable long-term audit trail for production secret access.
 */
export class LoggerAuditLog implements ISecretAuditLog {
  record(event: SecretAuditEvent): void {
    const payload = {
      key: event.key,
      action: event.action,
      source: event.source,
      version: event.version,
      actor: event.actor,
      timestamp: event.timestamp.toISOString(),
      ...event.metadata,
    };

    if (WARN_ACTIONS.has(event.action)) {
      logger.warn(`[secret-audit] ${event.action}: ${event.key}`, payload);
    } else {
      logger.info(`[secret-audit] ${event.action}: ${event.key}`, payload);
    }
  }
}
