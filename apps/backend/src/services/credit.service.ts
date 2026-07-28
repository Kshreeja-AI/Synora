import { prisma } from '@synora/database';
import { logger } from '../utils/logger.js';
import { NotFoundException } from '@synora/shared';
import { recordAuditEvent } from './audit.service.js';

export class InsufficientCreditsError extends Error {
  constructor() {
    super('Insufficient credits');
    this.name = 'InsufficientCreditsError';
  }
}

export async function getCreditBalance(actorId: string, workspaceId: string) {
  const credits = await prisma.workspaceCredits.findUnique({
    where: { workspaceId },
  });

  if (!credits) {
    throw new NotFoundException('Workspace credits');
  }

  return credits.balance;
}

export async function listCreditLedger(
  actorId: string,
  workspaceId: string,
  options?: { before?: Date }
) {
  const entries = await prisma.creditLedgerEntry.findMany({
    where: {
      workspaceId,
      ...(options?.before && { createdAt: { lt: options.before } }),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return entries;
}

export async function grantCredits(
  actorUserId: string,
  workspaceId: string,
  input: { amount: number; reason: string }
) {
  const existing = await prisma.workspaceCredits.findUnique({
    where: { workspaceId },
  });

  if (!existing) {
    throw new NotFoundException('Workspace credits');
  }

  const newBalance = existing.balance + input.amount;

  const updated = await prisma.workspaceCredits.update({
    where: { workspaceId },
    data: { balance: newBalance },
  });

  await prisma.creditLedgerEntry.create({
    data: {
      workspaceId,
      type: 'GRANT',
      amount: input.amount,
      balanceAfter: newBalance,
      reason: input.reason,
      actorId: actorUserId,
    },
  });

  await recordAuditEvent(workspaceId, actorUserId, 'credits_granted', 'CREDITS', undefined, {
    amount: input.amount,
    reason: input.reason,
  });

  logger.info('[admin] credits granted', {
    actorId: actorUserId,
    workspaceId,
    amount: input.amount,
    reason: input.reason,
  });

  return updated;
}

export async function adjustCredits(
  actorUserId: string,
  workspaceId: string,
  input: { amount: number; reason: string }
) {
  const existing = await prisma.workspaceCredits.findUnique({
    where: { workspaceId },
  });

  if (!existing) {
    throw new NotFoundException('Workspace credits');
  }

  const newBalance = Math.max(0, existing.balance + input.amount);

  const updated = await prisma.workspaceCredits.update({
    where: { workspaceId },
    data: { balance: newBalance },
  });

  await prisma.creditLedgerEntry.create({
    data: {
      workspaceId,
      type: 'ADJUSTMENT',
      amount: input.amount,
      balanceAfter: newBalance,
      reason: input.reason,
      actorId: actorUserId,
    },
  });

  await recordAuditEvent(workspaceId, actorUserId, 'credits_adjusted', 'CREDITS', undefined, {
    amount: input.amount,
    reason: input.reason,
  });

  logger.info('[admin] credits adjusted', {
    actorId: actorUserId,
    workspaceId,
    amount: input.amount,
    reason: input.reason,
  });

  return updated;
}

export async function recordUsage(
  workspaceId: string,
  input: { capability: string; quantity: number; creditsCost: number; userId?: string; metadata?: Record<string, unknown> }
) {
  const existing = await prisma.workspaceCredits.findUnique({
    where: { workspaceId },
  });

  if (!existing) {
    throw new NotFoundException('Workspace credits');
  }

  if (existing.balance < input.creditsCost) {
    throw new InsufficientCreditsError();
  }

  const newBalance = existing.balance - input.creditsCost;

  await prisma.usageRecord.create({
    data: {
      workspaceId,
      userId: input.userId,
      capability: input.capability,
      quantity: input.quantity,
      creditsCost: input.creditsCost,
      metadata: input.metadata as any,
    },
  });

  await prisma.creditLedgerEntry.create({
    data: {
      workspaceId,
      type: 'DEDUCTION',
      amount: -input.creditsCost,
      balanceAfter: newBalance,
      reason: `Usage: ${input.capability}`,
    },
  });

  await prisma.workspaceCredits.update({
    where: { workspaceId },
    data: { balance: newBalance },
  });
}

export async function getUsageSummary(
  actorId: string,
  workspaceId: string,
  options?: { from?: Date; to?: Date }
) {
  const records = await prisma.usageRecord.findMany({
    where: {
      workspaceId,
      ...(options?.from && { createdAt: { gte: options.from } }),
      ...(options?.to && { createdAt: { lte: options.to } }),
    },
    orderBy: { createdAt: 'desc' },
  });

  const summary: Record<string, { quantity: number; creditsCost: number }> = {};

  for (const record of records) {
    if (!summary[record.capability]) {
      summary[record.capability] = { quantity: 0, creditsCost: 0 };
    }
    summary[record.capability].quantity += record.quantity;
    summary[record.capability].creditsCost += record.creditsCost;
  }

  return summary;
}
