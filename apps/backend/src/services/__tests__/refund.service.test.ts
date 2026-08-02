import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { refundInvoice } from '../refund.service';
import { NotFoundException, ValidationException, ServiceUnavailableException } from '@synora/shared';
import * as billingModule from '../../billing/index.js';

describe('refund.service', () => {
  const testWorkspaceIds: string[] = [];
  const testPlanIds: string[] = [];
  let workspaceId: string;
  let planId: string;
  let subscriptionId: string;
  let invoiceId: string;
  let ownerId: string;

  beforeAll(async () => {
    await initConfig();
  });

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: 'Test Workspace', slug: `test-${Date.now()}` },
    });
    workspaceId = workspace.id;
    testWorkspaceIds.push(workspaceId);

    await prisma.workspaceCredits.create({
      data: { workspaceId, balance: 10000 },
    });

    const owner = await prisma.user.create({
      data: { email: `owner-${Date.now()}@test.com`, password: 'hashed' },
    });
    ownerId = owner.id;

    await prisma.workspaceMember.create({
      data: { workspaceId, userId: ownerId, role: 'OWNER' },
    });

    const plan = await prisma.plan.create({
      data: {
        key: `refund-plan-${Date.now()}`,
        name: 'Refund Plan',
        interval: 'MONTH',
        priceCents: 9999,
        creditsPerInterval: 5000,
        status: 'ACTIVE',
      },
    });
    planId = plan.id;
    testPlanIds.push(planId);

    const subscription = await prisma.subscription.create({
      data: { workspaceId, planId, status: 'ACTIVE' },
    });
    subscriptionId = subscription.id;

    const invoice = await prisma.invoice.create({
      data: {
        subscriptionId,
        workspaceId,
        provider: 'stripe',
        externalInvoiceId: `inv_refund_test_${Date.now()}`,
        status: 'PAID',
        amountDueCents: 9999,
        amountPaidCents: 9999,
        paidAt: new Date(),
      },
    });
    invoiceId = invoice.id;
  });

  afterEach(async () => {
    if (testWorkspaceIds.length > 0) {
      await prisma.creditLedgerEntry.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
      await prisma.invoice.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
      await prisma.subscription.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
      await prisma.workspaceCredits.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: testWorkspaceIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: testWorkspaceIds } } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      testWorkspaceIds.length = 0;
    }
    if (testPlanIds.length > 0) {
      await prisma.plan.deleteMany({ where: { id: { in: testPlanIds } } });
      testPlanIds.length = 0;
    }
  });

  function mockProviderWithRefund(amountCents: number) {
    const mockProvider = {
      isConfigured: vi.fn().mockReturnValue(true),
      refundInvoice: vi.fn().mockResolvedValue({ externalRefundId: `re_${Date.now()}`, amountCents }),
      createCustomer: vi.fn(),
      createCheckoutSession: vi.fn(),
      createSetupSession: vi.fn(),
      updateSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      createBillingPortalSession: vi.fn(),
      listPaymentMethods: vi.fn(),
      removePaymentMethod: vi.fn(),
      verifyAndParseWebhookEvent: vi.fn(),
    };
    vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);
    return mockProvider;
  }

  it('issues a full refund, records it, and updates the invoice running total', async () => {
    mockProviderWithRefund(9999);

    const refund = await refundInvoice(ownerId, workspaceId, invoiceId, { reason: 'Customer requested' });

    expect(refund.amountCents).toBe(9999);
    expect(refund.workspaceId).toBe(workspaceId);
    expect(refund.invoiceId).toBe(invoiceId);

    const updatedInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(updatedInvoice?.refundedAmountCents).toBe(9999);
  });

  it('claws back credits proportional to the refunded amount', async () => {
    mockProviderWithRefund(9999);

    await refundInvoice(ownerId, workspaceId, invoiceId, { reason: 'Full refund' });

    const credits = await prisma.workspaceCredits.findUnique({ where: { workspaceId } });
    // Full refund of a plan granting 5000 credits/interval claws back all 5000.
    expect(credits?.balance).toBe(10000 - 5000);

    const ledgerEntry = await prisma.creditLedgerEntry.findFirst({
      where: { workspaceId, type: 'REFUND' },
    });
    expect(ledgerEntry?.amount).toBe(-5000);
  });

  it('clamps the clawback at the current balance instead of going negative', async () => {
    await prisma.workspaceCredits.update({ where: { workspaceId }, data: { balance: 1000 } });
    mockProviderWithRefund(9999);

    await refundInvoice(ownerId, workspaceId, invoiceId, { reason: 'Already spent most credits' });

    const credits = await prisma.workspaceCredits.findUnique({ where: { workspaceId } });
    expect(credits?.balance).toBe(0);
  });

  it('supports a partial refund and claws back a proportional fraction of credits', async () => {
    mockProviderWithRefund(4999); // roughly half of 9999

    await refundInvoice(ownerId, workspaceId, invoiceId, { amountCents: 4999, reason: 'Partial refund' });

    const updatedInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(updatedInvoice?.refundedAmountCents).toBe(4999);

    const credits = await prisma.workspaceCredits.findUnique({ where: { workspaceId } });
    // 4999/9999 of 5000 credits ≈ 2500
    expect(credits?.balance).toBe(10000 - 2500);
  });

  it('allows a second partial refund up to the remaining refundable amount', async () => {
    mockProviderWithRefund(5000);
    await refundInvoice(ownerId, workspaceId, invoiceId, { amountCents: 5000, reason: 'First partial' });

    mockProviderWithRefund(4999);
    await refundInvoice(ownerId, workspaceId, invoiceId, { amountCents: 4999, reason: 'Second partial' });

    const updatedInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(updatedInvoice?.refundedAmountCents).toBe(9999);

    const refunds = await prisma.refund.findMany({ where: { invoiceId } });
    expect(refunds).toHaveLength(2);
  });

  it('rejects a refund that would exceed what was actually paid', async () => {
    mockProviderWithRefund(9999);

    await expect(
      refundInvoice(ownerId, workspaceId, invoiceId, { amountCents: 20000, reason: 'Too much' })
    ).rejects.toThrow(ValidationException);
  });

  it('rejects refunding an invoice that is not PAID', async () => {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID' } });
    mockProviderWithRefund(9999);

    await expect(
      refundInvoice(ownerId, workspaceId, invoiceId, { reason: 'Should not work' })
    ).rejects.toThrow(ValidationException);
  });

  it('rejects refunding an invoice that has already been fully refunded', async () => {
    mockProviderWithRefund(9999);
    await refundInvoice(ownerId, workspaceId, invoiceId, { reason: 'Full refund' });

    mockProviderWithRefund(9999);
    await expect(
      refundInvoice(ownerId, workspaceId, invoiceId, { reason: 'Refund again' })
    ).rejects.toThrow(ValidationException);
  });

  it('throws NotFoundException for a non-existent invoice', async () => {
    await expect(
      refundInvoice(ownerId, workspaceId, 'nonexistent', { reason: 'test' })
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the invoice belongs to a different workspace', async () => {
    const otherWorkspace = await prisma.workspace.create({
      data: { name: 'Other Workspace', slug: `other-${Date.now()}` },
    });
    testWorkspaceIds.push(otherWorkspace.id);

    await expect(
      refundInvoice(ownerId, otherWorkspace.id, invoiceId, { reason: 'Wrong workspace' })
    ).rejects.toThrow(NotFoundException);
  });

  it('surfaces a billing provider failure as ServiceUnavailableException', async () => {
    const mockProvider = {
      isConfigured: vi.fn().mockReturnValue(true),
      refundInvoice: vi.fn().mockRejectedValue(new billingModule.BillingProviderError('REFUND_FAILED', 'card network down')),
      createCustomer: vi.fn(),
      createCheckoutSession: vi.fn(),
      createSetupSession: vi.fn(),
      updateSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      createBillingPortalSession: vi.fn(),
      listPaymentMethods: vi.fn(),
      removePaymentMethod: vi.fn(),
      verifyAndParseWebhookEvent: vi.fn(),
    };
    vi.spyOn(billingModule, 'resolveBillingProvider').mockResolvedValue(mockProvider as any);

    await expect(
      refundInvoice(ownerId, workspaceId, invoiceId, { reason: 'Provider down' })
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
