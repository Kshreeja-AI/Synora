import type { Subscription, Plan, WorkspaceCredits, CreditLedgerEntry } from '../types';

export function createMockPlan(overrides?: Partial<Plan>): Plan {
  return {
    id: '1',
    key: 'basic',
    name: 'Basic',
    interval: 'MONTH',
    priceCents: 9999,
    creditsPerInterval: 5000,
    features: {},
    trialDays: 0,
    sortOrder: 1,
    status: 'ACTIVE',
    isDefault: false,
    ...overrides,
  };
}

export function createMockSubscription(overrides?: Partial<Subscription>): Subscription {
  return {
    id: 'sub_1',
    workspaceId: 'workspace_1',
    planId: '1',
    plan: createMockPlan(),
    status: 'ACTIVE',
    externalSubscriptionId: null,
    externalCustomerId: null,
    provider: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockWorkspaceCredits(overrides?: Partial<WorkspaceCredits>): WorkspaceCredits {
  return {
    id: 'wc_1',
    workspaceId: 'workspace_1',
    balance: 10000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockCreditLedgerEntry(
  overrides?: Partial<CreditLedgerEntry>,
): CreditLedgerEntry {
  return {
    id: 'cle_1',
    workspaceId: 'workspace_1',
    type: 'DEDUCTION',
    amount: -100,
    balanceAfter: 9900,
    reason: 'API usage',
    actorId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
