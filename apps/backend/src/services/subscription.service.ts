import { prisma } from '@synora/database';
import { resolveBillingProvider, BillingProviderError } from '../billing/index.js';
import { ServiceUnavailableException, NotFoundException } from '@synora/shared';
import { recordAuditEvent } from './audit.service.js';
import { createNotification } from './notification.service.js';

async function notifyWorkspaceOwner(workspaceId: string, title: string, body: string) {
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId, role: 'OWNER' },
    select: { userId: true },
  });
  if (owner) {
    await createNotification(owner.userId, { type: 'BILLING', title, body });
  }
}

export async function getSubscriptionForWorkspace(actorId: string, workspaceId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });

  if (!subscription) {
    throw new NotFoundException('Subscription');
  }

  return subscription;
}

export async function ensureBillingCustomer(workspaceId: string): Promise<string> {
  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
    include: { workspace: true },
  });

  if (!subscription) {
    throw new NotFoundException('Subscription');
  }

  if (subscription.externalCustomerId) {
    return subscription.externalCustomerId;
  }

  try {
    const provider = await resolveBillingProvider();

    const customerId = await provider.createCustomer({
      workspaceId,
      email: subscription.workspace.id + '@workspace.local',
    });

    await prisma.subscription.update({
      where: { workspaceId },
      data: {
        externalCustomerId: customerId,
        provider: 'stripe',
      },
    });

    return customerId;
  } catch (error) {
    if (error instanceof BillingProviderError) {
      throw new ServiceUnavailableException(`Billing provider error: ${error.message}`);
    }
    throw error;
  }
}

export async function createCheckoutSession(
  actorId: string,
  workspaceId: string,
  input: { planId: string; successUrl: string; cancelUrl: string }
) {
  const customerId = await ensureBillingCustomer(workspaceId);
  const plan = await prisma.plan.findUnique({ where: { id: input.planId } });

  if (!plan) {
    throw new NotFoundException('Plan');
  }

  try {
    const provider = await resolveBillingProvider();
    const priceIds = plan.providerPriceIds as Record<string, string> | null;
    const priceId = priceIds?.stripe;
    if (!priceId) {
      throw new ServiceUnavailableException(
        `Plan "${plan.name}" has no Stripe price ID configured. ` +
        'An admin must set providerPriceIds.stripe on this plan before checkout.'
      );
    }
    const session = await provider.createCheckoutSession({
      customerId,
      priceId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });

    await recordAuditEvent(workspaceId, actorId, 'checkout_initiated', 'SUBSCRIPTION', undefined, {
      planId: input.planId,
    });

    return session;
  } catch (error) {
    if (error instanceof BillingProviderError) {
      throw new ServiceUnavailableException(`Billing provider error: ${error.message}`);
    }
    throw error;
  }
}

export async function changePlan(
  actorId: string,
  workspaceId: string,
  input: { planId: string }
) {
  const subscription = await getSubscriptionForWorkspace(actorId, workspaceId);

  if (!subscription.externalSubscriptionId) {
    throw new NotFoundException('Active subscription');
  }

  const plan = await prisma.plan.findUnique({ where: { id: input.planId } });
  if (!plan) {
    throw new NotFoundException('Plan');
  }

  try {
    const provider = await resolveBillingProvider();
    const priceIds = plan.providerPriceIds as Record<string, string> | null;
    const priceId = priceIds?.stripe;
    if (!priceId) {
      throw new ServiceUnavailableException(
        `Plan "${plan.name}" has no Stripe price ID configured. ` +
        'An admin must set providerPriceIds.stripe on this plan before changing.'
      );
    }
    await provider.updateSubscription({
      subscriptionId: subscription.externalSubscriptionId,
      priceId,
    });

    const updated = await prisma.subscription.update({
      where: { workspaceId },
      data: { planId: input.planId },
      include: { plan: true },
    });

    await recordAuditEvent(workspaceId, actorId, 'plan_changed', 'SUBSCRIPTION', undefined, {
      fromPlanId: subscription.planId,
      toPlanId: input.planId,
    });

    await notifyWorkspaceOwner(workspaceId, 'Plan Changed', `Your plan has been updated to ${plan.name}`);

    return updated;
  } catch (error) {
    if (error instanceof BillingProviderError) {
      throw new ServiceUnavailableException(`Billing provider error: ${error.message}`);
    }
    throw error;
  }
}

export async function cancelSubscription(
  actorId: string,
  workspaceId: string,
  input: { atPeriodEnd: boolean }
) {
  const subscription = await getSubscriptionForWorkspace(actorId, workspaceId);

  if (!subscription.externalSubscriptionId) {
    throw new NotFoundException('Active subscription');
  }

  try {
    const provider = await resolveBillingProvider();
    await provider.cancelSubscription({
      subscriptionId: subscription.externalSubscriptionId,
      atPeriodEnd: input.atPeriodEnd,
    });

    const updated = await prisma.subscription.update({
      where: { workspaceId },
      data: {
        status: input.atPeriodEnd ? 'ACTIVE' : 'CANCELED',
        cancelAtPeriodEnd: input.atPeriodEnd,
      },
      include: { plan: true },
    });

    await recordAuditEvent(workspaceId, actorId, 'subscription_canceled', 'SUBSCRIPTION', undefined, {
      atPeriodEnd: input.atPeriodEnd,
    });

    const message = input.atPeriodEnd
      ? 'Your subscription will be canceled at the end of the current billing period'
      : 'Your subscription has been canceled immediately';

    await notifyWorkspaceOwner(workspaceId, 'Subscription Canceled', message);

    return updated;
  } catch (error) {
    if (error instanceof BillingProviderError) {
      throw new ServiceUnavailableException(`Billing provider error: ${error.message}`);
    }
    throw error;
  }
}

export async function reactivateSubscription(actorId: string, workspaceId: string) {
  const subscription = await getSubscriptionForWorkspace(actorId, workspaceId);

  if (!subscription.cancelAtPeriodEnd) {
    throw new Error('Subscription not scheduled for cancellation');
  }

  const updated = await prisma.subscription.update({
    where: { workspaceId },
    data: { cancelAtPeriodEnd: false },
    include: { plan: true },
  });

  await recordAuditEvent(workspaceId, actorId, 'subscription_reactivated', 'SUBSCRIPTION');

  await notifyWorkspaceOwner(workspaceId, 'Subscription Reactivated', 'Your subscription cancellation has been canceled');

  return updated;
}

export async function createBillingPortalSession(
  actorId: string,
  workspaceId: string,
  returnUrl: string
) {
  const customerId = await ensureBillingCustomer(workspaceId);

  try {
    const provider = await resolveBillingProvider();
    const session = await provider.createBillingPortalSession({
      customerId,
      returnUrl,
    });

    return session;
  } catch (error) {
    if (error instanceof BillingProviderError) {
      throw new ServiceUnavailableException(`Billing provider error: ${error.message}`);
    }
    throw error;
  }
}
