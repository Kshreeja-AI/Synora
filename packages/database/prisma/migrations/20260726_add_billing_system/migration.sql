-- AlterEnum: Add BILLING to NotificationType
ALTER TYPE "NotificationType" ADD VALUE 'BILLING';

-- CreateTable: Plan
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "interval" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "creditsPerInterval" INTEGER NOT NULL DEFAULT 0,
    "trialDays" INTEGER,
    "features" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "providerPriceIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Subscription
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" TEXT,
    "externalCustomerId" TEXT,
    "externalSubscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Invoice
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalInvoiceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountDueCents" INTEGER NOT NULL,
    "amountPaidCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "hostedInvoiceUrl" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PaymentMethod
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalPaymentMethodId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "expiryMonth" INTEGER,
    "expiryYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WorkspaceCredits
CREATE TABLE "WorkspaceCredits" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceCredits_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CreditLedgerEntry
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable: UsageRecord
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "capability" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "creditsCost" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProcessedWebhookEvent
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for Plan
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");
CREATE INDEX "Plan_status_idx" ON "Plan"("status");
CREATE INDEX "Plan_isDefault_idx" ON "Plan"("isDefault");

-- CreateIndex for Subscription
CREATE UNIQUE INDEX "Subscription_workspaceId_key" ON "Subscription"("workspaceId");
CREATE INDEX "Subscription_workspaceId_idx" ON "Subscription"("workspaceId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex for Invoice
CREATE UNIQUE INDEX "Invoice_externalInvoiceId_key" ON "Invoice"("externalInvoiceId");
CREATE INDEX "Invoice_workspaceId_idx" ON "Invoice"("workspaceId");
CREATE INDEX "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex for PaymentMethod
CREATE UNIQUE INDEX "PaymentMethod_externalPaymentMethodId_key" ON "PaymentMethod"("externalPaymentMethodId");
CREATE INDEX "PaymentMethod_workspaceId_idx" ON "PaymentMethod"("workspaceId");
CREATE INDEX "PaymentMethod_subscriptionId_idx" ON "PaymentMethod"("subscriptionId");

-- CreateIndex for WorkspaceCredits
CREATE UNIQUE INDEX "WorkspaceCredits_workspaceId_key" ON "WorkspaceCredits"("workspaceId");
CREATE INDEX "WorkspaceCredits_workspaceId_idx" ON "WorkspaceCredits"("workspaceId");

-- CreateIndex for CreditLedgerEntry
CREATE INDEX "CreditLedgerEntry_workspaceId_createdAt_idx" ON "CreditLedgerEntry"("workspaceId", "createdAt");

-- CreateIndex for UsageRecord
CREATE INDEX "UsageRecord_workspaceId_createdAt_idx" ON "UsageRecord"("workspaceId", "createdAt");
CREATE INDEX "UsageRecord_capability_createdAt_idx" ON "UsageRecord"("capability", "createdAt");

-- CreateIndex for ProcessedWebhookEvent
CREATE UNIQUE INDEX "ProcessedWebhookEvent_provider_externalEventId_key" ON "ProcessedWebhookEvent"("provider", "externalEventId");
CREATE INDEX "ProcessedWebhookEvent_provider_createdAt_idx" ON "ProcessedWebhookEvent"("provider", "createdAt");

-- Add Foreign Keys
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;

ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE;
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;

ALTER TABLE "WorkspaceCredits" ADD CONSTRAINT "WorkspaceCredits_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;

ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;

ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
