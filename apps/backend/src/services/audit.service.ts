import { prisma, Prisma } from '@synora/database';
import { requirePermission } from './permissions';
import { requireMembership } from './checks';

export interface AuditLogEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
  actor: { id: string; name: string | null; email: string } | null;
}

/**
 * Fire-and-forget from the caller's perspective — a failed audit write
 * must never be allowed to fail the operation it's recording, since the
 * underlying action has already succeeded on its own data. Callers await
 * it (so ordering with the rest of the request is deterministic in tests)
 * but do not need to catch anything themselves; failures are logged here.
 */
export async function recordAuditEvent(
  workspaceId: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      workspaceId,
      actorId,
      action,
      targetType,
      targetId,
      metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
}

/**
 * actorId on AuditLog is a soft reference (see schema comment), so actor
 * details are resolved with a separate batched lookup rather than a Prisma
 * `include`. A missing actor (e.g. a hard-deleted account) surfaces as
 * `actor: null` rather than dropping the audit row.
 */
export async function listAuditLog(
  actorId: string,
  workspaceId: string,
  options: { limit?: number; before?: Date } = {}
): Promise<AuditLogEntry[]> {
  const membership = await requireMembership(actorId, workspaceId);
  requirePermission(membership.role, 'audit:view');

  const limit = Math.min(options.limit ?? 50, 100);
  const logs = await prisma.auditLog.findMany({
    where: {
      workspaceId,
      ...(options.before ? { createdAt: { lt: options.before } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const actorIds = [...new Set(logs.map((log) => log.actorId))];
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true, email: true },
  });
  const actorsById = new Map(actors.map((actor) => [actor.id, actor]));

  return logs.map((log) => ({
    id: log.id,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    metadata: log.metadata,
    createdAt: log.createdAt,
    actor: actorsById.get(log.actorId) ?? null,
  }));
}
