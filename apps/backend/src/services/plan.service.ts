import { prisma } from '@synora/database';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { NotFoundException } from '@synora/shared';

export interface CreatePlanInput {
  key: string;
  name: string;
  interval: 'MONTH' | 'YEAR';
  priceCents: number;
  creditsPerInterval?: number;
  trialDays?: number;
  features?: Record<string, unknown>;
  sortOrder?: number;
}

export interface UpdatePlanInput {
  name?: string;
  priceCents?: number;
  creditsPerInterval?: number;
  trialDays?: number;
  features?: Record<string, unknown>;
  sortOrder?: number;
}

export async function listActivePlans() {
  const plans = await prisma.plan.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { sortOrder: 'asc' },
  });
  return plans;
}

export async function listAllPlans() {
  const plans = await prisma.plan.findMany({
    orderBy: { sortOrder: 'asc' },
  });
  return plans;
}

export async function getDefaultPlan() {
  const plan = await prisma.plan.findFirst({
    where: { isDefault: true },
  });

  if (!plan) {
    throw new NotFoundException('Default plan');
  }

  return plan;
}

export async function getPlan(planId: string) {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
  });

  if (!plan) {
    throw new NotFoundException('Plan');
  }

  return plan;
}

export async function createPlan(actorUserId: string, input: CreatePlanInput) {
  const plan = await prisma.plan.create({
    data: {
      key: input.key,
      name: input.name,
      interval: input.interval,
      priceCents: input.priceCents,
      creditsPerInterval: input.creditsPerInterval || 0,
      trialDays: input.trialDays,
      features: input.features as Prisma.InputJsonValue,
      sortOrder: input.sortOrder || 0,
      status: 'ACTIVE',
    },
  });

  logger.info('[admin] plan created', {
    actorId: actorUserId,
    planId: plan.id,
    planKey: plan.key,
    planName: plan.name,
  });

  return plan;
}

export async function updatePlan(actorUserId: string, planId: string, input: UpdatePlanInput) {
  const plan = await getPlan(planId);

  const updated = await prisma.plan.update({
    where: { id: planId },
    data: {
      name: input.name ?? plan.name,
      priceCents: input.priceCents ?? plan.priceCents,
      creditsPerInterval: input.creditsPerInterval ?? plan.creditsPerInterval,
      trialDays: input.trialDays ?? plan.trialDays,
      features: (input.features ?? plan.features) as Prisma.InputJsonValue,
      sortOrder: input.sortOrder ?? plan.sortOrder,
    },
  });

  logger.info('[admin] plan updated', {
    actorId: actorUserId,
    planId: planId,
    planKey: plan.key,
    changes: {
      name: input.name,
      priceCents: input.priceCents,
      creditsPerInterval: input.creditsPerInterval,
    },
  });

  return updated;
}

export async function archivePlan(actorUserId: string, planId: string) {
  const plan = await getPlan(planId);

  const updated = await prisma.plan.update({
    where: { id: planId },
    data: { status: 'ARCHIVED' },
  });

  logger.info('[admin] plan archived', {
    actorId: actorUserId,
    planId: planId,
    planKey: plan.key,
  });

  return updated;
}

export async function setDefaultPlan(actorUserId: string, planId: string) {
  const plan = await getPlan(planId);

  await prisma.plan.updateMany({
    where: { isDefault: true },
    data: { isDefault: false },
  });

  const updated = await prisma.plan.update({
    where: { id: planId },
    data: { isDefault: true },
  });

  logger.info('[admin] default plan set', {
    actorId: actorUserId,
    planId: planId,
    planKey: plan.key,
  });

  return updated;
}
