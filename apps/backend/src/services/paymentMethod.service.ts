import { prisma } from '@synora/database';
import { resolveBillingProvider, BillingProviderError } from '../billing/index.js';
import { ServiceUnavailableException, NotFoundException } from '@synora/shared';
import { logger } from '../utils/logger.js';

export async function listPaymentMethods(actorId: string, workspaceId: string) {
  const methods = await prisma.paymentMethod.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });

  return methods;
}

export async function createSetupSession(
  actorId: string,
  workspaceId: string,
  input: { successUrl: string; cancelUrl: string }
) {
  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
  });

  if (!subscription) {
    throw new NotFoundException('Subscription');
  }

  let customerId = subscription.externalCustomerId;

  if (!customerId) {
    try {
      const provider = await resolveBillingProvider();
      customerId = await provider.createCustomer({
        workspaceId,
        email: workspaceId + '@workspace.local',
      });

      await prisma.subscription.update({
        where: { workspaceId },
        data: {
          externalCustomerId: customerId,
          provider: 'stripe',
        },
      });
    } catch (error) {
      if (error instanceof BillingProviderError) {
        throw new ServiceUnavailableException(`Billing provider error: ${error.message}`);
      }
      throw error;
    }
  }

  try {
    const provider = await resolveBillingProvider();
    const session = await provider.createSetupSession({
      customerId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });

    return session;
  } catch (error) {
    if (error instanceof BillingProviderError) {
      throw new ServiceUnavailableException(`Billing provider error: ${error.message}`);
    }
    throw error;
  }
}

export async function setDefaultPaymentMethod(
  actorId: string,
  workspaceId: string,
  paymentMethodId: string
) {
  const method = await prisma.paymentMethod.findUnique({
    where: { id: paymentMethodId },
  });

  if (!method || method.workspaceId !== workspaceId) {
    throw new NotFoundException('Payment method');
  }

  await prisma.paymentMethod.updateMany({
    where: { workspaceId },
    data: { isDefault: false },
  });

  const updated = await prisma.paymentMethod.update({
    where: { id: paymentMethodId },
    data: { isDefault: true },
  });

  logger.info('Default payment method set', {
    actorId,
    workspaceId,
    paymentMethodId,
  });

  return updated;
}

export async function removePaymentMethod(actorId: string, workspaceId: string, paymentMethodId: string) {
  const method = await prisma.paymentMethod.findUnique({
    where: { id: paymentMethodId },
  });

  if (!method || method.workspaceId !== workspaceId) {
    throw new NotFoundException('Payment method');
  }

  try {
    const provider = await resolveBillingProvider();
    await provider.removePaymentMethod({
      paymentMethodId: method.externalPaymentMethodId,
    });
  } catch (error) {
    if (error instanceof BillingProviderError) {
      throw new ServiceUnavailableException(`Billing provider error: ${error.message}`);
    }
    throw error;
  }

  await prisma.paymentMethod.delete({
    where: { id: paymentMethodId },
  });

  logger.info('Payment method removed', {
    actorId,
    workspaceId,
    paymentMethodId,
  });
}
