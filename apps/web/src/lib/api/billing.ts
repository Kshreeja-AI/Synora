import { api } from './client';
import type {
  Plan,
  Subscription,
  PaymentMethod,
  Invoice,
  WorkspaceCredits,
  CreditLedgerEntry,
} from './types';

export interface CreateCheckoutSessionRequest {
  planId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutSessionResponse {
  url: string;
  sessionId: string;
}

export interface ChangePlanRequest {
  planId: string;
}

export interface CancelSubscriptionRequest {
  atPeriodEnd: boolean;
}

export interface CreateBillingPortalSessionRequest {
  returnUrl: string;
}

export interface CreateBillingPortalSessionResponse {
  url: string;
}

// Plans endpoints
export function listPlans(): Promise<Plan[]> {
  return api.get<Plan[]>('/api/billing/plans');
}

export function getPlan(id: string): Promise<Plan> {
  return api.get<Plan>(`/api/billing/plans/${id}`);
}

// Subscription endpoints
export function getSubscription(workspaceId: string): Promise<Subscription> {
  return api.get<Subscription>(`/api/workspaces/${workspaceId}/billing/subscription`);
}

export function createCheckoutSession(
  workspaceId: string,
  input: CreateCheckoutSessionRequest
): Promise<CreateCheckoutSessionResponse> {
  return api.post<CreateCheckoutSessionResponse>(
    `/api/workspaces/${workspaceId}/billing/checkout`,
    input
  );
}

export function changePlan(workspaceId: string, input: ChangePlanRequest): Promise<Subscription> {
  return api.patch<Subscription>(`/api/workspaces/${workspaceId}/billing/subscription`, input);
}

export function cancelSubscription(
  workspaceId: string,
  input: CancelSubscriptionRequest
): Promise<Subscription> {
  return api.post<Subscription>(
    `/api/workspaces/${workspaceId}/billing/subscription/cancel`,
    input
  );
}

export function reactivateSubscription(workspaceId: string): Promise<Subscription> {
  return api.post<Subscription>(
    `/api/workspaces/${workspaceId}/billing/subscription/reactivate`,
    {}
  );
}

// Payment methods endpoints
export function listPaymentMethods(workspaceId: string): Promise<PaymentMethod[]> {
  return api.get<PaymentMethod[]>(`/api/workspaces/${workspaceId}/billing/payment-methods`);
}

export function createBillingPortalSession(
  workspaceId: string,
  input: CreateBillingPortalSessionRequest
): Promise<CreateBillingPortalSessionResponse> {
  return api.post<CreateBillingPortalSessionResponse>(
    `/api/workspaces/${workspaceId}/billing/portal`,
    input
  );
}

// Invoices endpoints
export function listInvoices(workspaceId: string): Promise<Invoice[]> {
  return api.get<Invoice[]>(`/api/workspaces/${workspaceId}/billing/invoices`);
}

// Credits endpoints
export function getCreditBalance(workspaceId: string): Promise<WorkspaceCredits> {
  return api.get<WorkspaceCredits>(`/api/workspaces/${workspaceId}/billing/credits`);
}

export function listCreditLedger(workspaceId: string): Promise<CreditLedgerEntry[]> {
  return api.get<CreditLedgerEntry[]>(`/api/workspaces/${workspaceId}/billing/credits/ledger`);
}

// Usage endpoints
export function getUsageSummary(workspaceId: string): Promise<Record<string, { quantity: number; creditsCost: number }>> {
  return api.get<Record<string, { quantity: number; creditsCost: number }>>(
    `/api/workspaces/${workspaceId}/billing/usage`
  );
}
