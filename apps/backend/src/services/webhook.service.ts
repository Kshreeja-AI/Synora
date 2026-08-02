import { prisma } from '@synora/database';
import { resolveBillingProvider, BillingProviderError } from '../billing/index.js';
import { ServiceUnavailableException } from '@synora/shared';
import { logger } from '../utils/logger.js';
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

export async function handleBillingWebhook(rawBody: Buffer, signatureHeader: string): Promise<void> {
  try {
    const provider = await resolveBillingProvider();

    if (!provider.isConfigured()) {
      throw new ServiceUnavailableException('Billing provider not configured');
    }

    const event = await provider.verifyAndParseWebhookEvent(rawBody, signatureHeader);

    const existing = await prisma.processedWebhookEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: 'stripe',
          externalEventId: event.id,
        },
      },
    });

    if (existing) {
      logger.info('Webhook event already processed', { eventId: event.id });
      return;
    }

    await prisma.processedWebhookEvent.create({
      data: {
        provider: 'stripe',
        externalEventId: event.id,
      },
    });

    const data = event.data as Record<string, unknown>;

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(data);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(data);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(data);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(data);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(data);
        break;

      case 'payment_method.attached':
        await handlePaymentMethodAttached(data);
        break;

      case 'payment_method.detached':
        await handlePaymentMethodDetached(data);
        break;

      default:
        logger.info('Unhandled webhook event type', { type: event.type, eventId: event.id });
    }
  } catch (error) {
    if (error instanceof BillingProviderError) {
      throw new ServiceUnavailableException(`Webhook verification failed: ${error.message}`);
    }
    throw error;
  }
}

async function handleCheckoutCompleted(data: Record<string, unknown>) {
  const subscriptionId = data.subscription as string;
  const customerId = data.customer as string;

  if (!subscriptionId || !customerId) {
    logger.warn('Invalid checkout completed event data', { data });
    return;
  }

  const subscription = await prisma.subscription.findFirst({
    where: {
      externalSubscriptionId: subscriptionId,
    },
  });

  if (subscription) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        externalSubscriptionId: subscriptionId,
        status: 'ACTIVE',
      },
    });
  }

  logger.info('Checkout completed', { subscriptionId, customerId });
}

async function handleSubscriptionUpdated(data: Record<string, unknown>) {
  const subscriptionId = data.id as string;
  const status = data.status as string;

  if (!subscriptionId) {
    logger.warn('Invalid subscription updated event data', { data });
    return;
  }

  const subscription = await prisma.subscription.findFirst({
    where: {
      externalSubscriptionId: subscriptionId,
    },
  });

  if (subscription) {
    const mappedStatus = mapSubscriptionStatus(status);
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: mappedStatus,
        currentPeriodStart: new Date((data.current_period_start as number) * 1000),
        currentPeriodEnd: new Date((data.current_period_end as number) * 1000),
        // Any transition away from PAST_DUE (recovered, canceled, trial
        // restarted, etc.) clears the dunning clock; a transition INTO
        // it starts one only if it wasn't already running, so repeated
        // "still past due" updates don't reset how long it's been failing.
        ...(mappedStatus === 'PAST_DUE'
          ? { pastDueSince: subscription.pastDueSince ?? new Date() }
          : { pastDueSince: null, paymentFailureCount: 0 }),
      },
    });
  }

  logger.info('Subscription updated', { subscriptionId, status });
}

async function handleSubscriptionDeleted(data: Record<string, unknown>) {
  const subscriptionId = data.id as string;

  if (!subscriptionId) {
    logger.warn('Invalid subscription deleted event data', { data });
    return;
  }

  const subscription = await prisma.subscription.findFirst({
    where: {
      externalSubscriptionId: subscriptionId,
    },
  });

  if (subscription) {
    const defaultPlan = await prisma.plan.findFirst({
      where: { isDefault: true },
    });

    if (defaultPlan) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: defaultPlan.id,
          status: 'ACTIVE',
          externalSubscriptionId: null,
          pastDueSince: null,
          paymentFailureCount: 0,
        },
      });
    }
  }

  logger.info('Subscription deleted, reverted to default plan', { subscriptionId });
}

async function handleInvoicePaid(data: Record<string, unknown>) {
  const invoiceId = data.id as string;
  const subscriptionId = data.subscription as string;
  const amountPaid = (data.amount_paid as number) || 0;
  const hostedUrl = data.hosted_invoice_url as string;

  if (!invoiceId || !subscriptionId) {
    logger.warn('Invalid invoice paid event data', { data });
    return;
  }

  const subscription = await prisma.subscription.findFirst({
    where: { externalSubscriptionId: subscriptionId },
  });

  if (!subscription) {
    logger.warn('Subscription not found for invoice', { subscriptionId });
    return;
  }

  await prisma.invoice.upsert({
    where: { externalInvoiceId: invoiceId },
    create: {
      subscriptionId: subscription.id,
      workspaceId: subscription.workspaceId,
      provider: 'stripe',
      externalInvoiceId: invoiceId,
      status: 'PAID',
      amountDueCents: amountPaid,
      amountPaidCents: amountPaid,
      hostedInvoiceUrl: hostedUrl,
      paidAt: new Date(),
    },
    update: {
      status: 'PAID',
      amountPaidCents: amountPaid,
      paidAt: new Date(),
    },
  });

  // A successful payment always means the subscription is no longer
  // struggling, even if it was PAST_DUE — this was previously never
  // reset here, so a workspace that fixed its card stayed flagged
  // PAST_DUE forever with no way back to ACTIVE short of Stripe
  // separately emitting a customer.subscription.updated event.
  if (subscription.status === 'PAST_DUE') {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'ACTIVE', pastDueSince: null, paymentFailureCount: 0 },
    });
    await notifyWorkspaceOwner(
      subscription.workspaceId,
      'Payment Recovered',
      'Your payment succeeded and your subscription is active again.',
    );
  }

  const plan = await prisma.plan.findUnique({
    where: { id: subscription.planId },
  });

  if (plan && plan.creditsPerInterval > 0) {
    const credits = await prisma.workspaceCredits.findUnique({
      where: { workspaceId: subscription.workspaceId },
    });

    if (credits) {
      const newBalance = credits.balance + plan.creditsPerInterval;

      await prisma.workspaceCredits.update({
        where: { workspaceId: subscription.workspaceId },
        data: { balance: newBalance },
      });

      await prisma.creditLedgerEntry.create({
        data: {
          workspaceId: subscription.workspaceId,
          type: 'GRANT',
          amount: plan.creditsPerInterval,
          balanceAfter: newBalance,
          reason: `Invoice paid: ${invoiceId}`,
        },
      });

      await notifyWorkspaceOwner(subscription.workspaceId, 'Credits Granted', `${plan.creditsPerInterval} credits have been added to your account`);
    }
  }

  logger.info('Invoice paid, credits granted', { invoiceId, subscriptionId });
}

async function handleInvoicePaymentFailed(data: Record<string, unknown>) {
  const invoiceId = data.id as string;
  const subscriptionId = data.subscription as string;

  if (!invoiceId || !subscriptionId) {
    logger.warn('Invalid invoice payment failed event data', { data });
    return;
  }

  const subscription = await prisma.subscription.findFirst({
    where: { externalSubscriptionId: subscriptionId },
  });

  if (!subscription) {
    logger.warn('Subscription not found for invoice', { subscriptionId });
    return;
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'PAST_DUE',
      // Only the first failure in a run starts the clock; Stripe's Smart
      // Retries fire this event multiple times for the same underlying
      // decline, and each one should extend the failure count without
      // resetting how long the workspace has actually been struggling.
      pastDueSince: subscription.pastDueSince ?? new Date(),
      paymentFailureCount: { increment: 1 },
    },
  });

  await prisma.invoice.upsert({
    where: { externalInvoiceId: invoiceId },
    create: {
      subscriptionId: subscription.id,
      workspaceId: subscription.workspaceId,
      provider: 'stripe',
      externalInvoiceId: invoiceId,
      status: 'OPEN',
      amountDueCents: (data.amount_due as number) || 0,
      amountPaidCents: 0,
    },
    update: {
      status: 'OPEN',
    },
  });

  await notifyWorkspaceOwner(subscription.workspaceId, 'Payment Failed', 'Your payment could not be processed. Please update your payment method.');

  logger.info('Invoice payment failed, subscription marked past due', { invoiceId, subscriptionId });
}

async function handlePaymentMethodAttached(data: Record<string, unknown>) {
  const paymentMethodId = data.id as string;
  const customerId = data.customer as string;

  if (!paymentMethodId || !customerId) {
    logger.warn('Invalid payment method attached event data', { data });
    return;
  }

  const subscription = await prisma.subscription.findFirst({
    where: { externalCustomerId: customerId },
  });

  if (!subscription) {
    logger.warn('Subscription not found for customer', { customerId });
    return;
  }

  const existing = await prisma.paymentMethod.findFirst({
    where: { externalPaymentMethodId: paymentMethodId },
  });

  if (!existing) {
    const cardType = ((data.type as string) || 'card').toUpperCase();
    const card = data.card as Record<string, unknown>;

    await prisma.paymentMethod.create({
      data: {
        subscriptionId: subscription.id,
        workspaceId: subscription.workspaceId,
        provider: 'stripe',
        externalPaymentMethodId: paymentMethodId,
        type: cardType === 'CARD' ? 'CARD' : 'OTHER',
        brand: (card?.brand as string) || undefined,
        last4: (card?.last4 as string) || undefined,
        expiryMonth: (card?.exp_month as number) || undefined,
        expiryYear: (card?.exp_year as number) || undefined,
        isDefault: true,
      },
    });
  }

  logger.info('Payment method attached', { paymentMethodId, customerId });
}

async function handlePaymentMethodDetached(data: Record<string, unknown>) {
  const paymentMethodId = data.id as string;

  if (!paymentMethodId) {
    logger.warn('Invalid payment method detached event data', { data });
    return;
  }

  await prisma.paymentMethod.deleteMany({
    where: { externalPaymentMethodId: paymentMethodId },
  });

  logger.info('Payment method detached', { paymentMethodId });
}

function mapSubscriptionStatus(stripeStatus: string): 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIAL' {
  switch (stripeStatus) {
    case 'active':
      return 'ACTIVE';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
      return 'CANCELED';
    case 'trialing':
      return 'TRIAL';
    default:
      return 'ACTIVE';
  }
}
