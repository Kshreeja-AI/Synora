import { prisma } from '@synora/database';
import { resolveBillingProvider, BillingProviderError } from '../billing/index.js';
import { NotFoundException, ValidationException, ServiceUnavailableException } from '@synora/shared';
import { recordAuditEvent } from './audit.service.js';
import { clawbackCreditsForRefund } from './credit.service.js';
import { createNotification } from './notification.service.js';
import { logger } from '../utils/logger.js';

async function notifyWorkspaceOwner(workspaceId: string, title: string, body: string) {
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId, role: 'OWNER' },
    select: { userId: true },
  });
  if (owner) {
    await createNotification(owner.userId, { type: 'BILLING', title, body });
  }
}

/**
 * Issues a refund against a paid invoice. Supports partial refunds and
 * multiple refunds against the same invoice — `Invoice.refundedAmountCents`
 * is the running total, validated against `amountPaidCents` so callers
 * can never refund more than was actually collected.
 *
 * Credits granted for the invoice (via handleInvoicePaid) are clawed back
 * proportionally to the refunded fraction, clamped at the workspace's
 * current balance — a workspace that already spent the credits keeps
 * what it used.
 */
export async function refundInvoice(
  actorUserId: string,
  workspaceId: string,
  invoiceId: string,
  input: { amountCents?: number; reason: string }
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { subscription: { include: { plan: true } } },
  });

  if (!invoice || invoice.workspaceId !== workspaceId) {
    throw new NotFoundException('Invoice');
  }

  if (invoice.status !== 'PAID') {
    throw new ValidationException(`Cannot refund an invoice with status ${invoice.status}`);
  }

  const alreadyRefunded = invoice.refundedAmountCents;
  const refundableCents = invoice.amountPaidCents - alreadyRefunded;

  if (refundableCents <= 0) {
    throw new ValidationException('Invoice has already been fully refunded');
  }

  const amountCents = input.amountCents ?? refundableCents;

  if (amountCents <= 0 || amountCents > refundableCents) {
    throw new ValidationException(
      `Refund amount must be between 1 and ${refundableCents} cents (already refunded: ${alreadyRefunded})`
    );
  }

  let result;
  try {
    const provider = await resolveBillingProvider();
    result = await provider.refundInvoice({
      externalInvoiceId: invoice.externalInvoiceId,
      amountCents,
    });
  } catch (error) {
    if (error instanceof BillingProviderError) {
      throw new ServiceUnavailableException(`Billing provider error: ${error.message}`);
    }
    throw error;
  }

  const [refund] = await prisma.$transaction([
    prisma.refund.create({
      data: {
        invoiceId: invoice.id,
        workspaceId,
        provider: invoice.provider,
        externalRefundId: result.externalRefundId,
        amountCents: result.amountCents,
        reason: input.reason,
        actorId: actorUserId,
      },
    }),
    prisma.invoice.update({
      where: { id: invoice.id },
      data: { refundedAmountCents: { increment: result.amountCents } },
    }),
  ]);

  const plan = invoice.subscription.plan;
  if (plan.creditsPerInterval > 0 && invoice.amountPaidCents > 0) {
    const creditsToClaw = Math.round(plan.creditsPerInterval * (result.amountCents / invoice.amountPaidCents));
    if (creditsToClaw > 0) {
      await clawbackCreditsForRefund(actorUserId, workspaceId, {
        amount: creditsToClaw,
        reason: `Refund of invoice ${invoice.externalInvoiceId}`,
      });
    }
  }

  await recordAuditEvent(workspaceId, actorUserId, 'invoice_refunded', 'INVOICE', invoice.id, {
    amountCents: result.amountCents,
    reason: input.reason,
    externalRefundId: result.externalRefundId,
  });

  await notifyWorkspaceOwner(
    workspaceId,
    'Refund Issued',
    `A refund of $${(result.amountCents / 100).toFixed(2)} has been issued to your original payment method.`,
  );

  logger.info('[billing] invoice refunded', {
    actorId: actorUserId,
    workspaceId,
    invoiceId: invoice.id,
    amountCents: result.amountCents,
  });

  return refund;
}
