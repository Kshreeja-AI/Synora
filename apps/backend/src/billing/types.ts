// Provider-agnostic billing types. Normalized shapes allow swapping
// providers (Stripe → Paddle → Chargebee) without touching call sites.

export interface BillingProvider {
  isConfigured(): boolean;
  createCustomer(input: { workspaceId: string; email: string }): Promise<string>;
  createCheckoutSession(input: { customerId: string; priceId: string; successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  createSetupSession(input: { customerId: string; successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  createBillingPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  updateSubscription(input: { subscriptionId: string; priceId: string }): Promise<void>;
  cancelSubscription(input: { subscriptionId: string; atPeriodEnd: boolean }): Promise<void>;
  listPaymentMethods(input: { customerId: string }): Promise<PaymentMethodSummary[]>;
  removePaymentMethod(input: { paymentMethodId: string }): Promise<void>;
  verifyAndParseWebhookEvent(rawBody: Buffer, signatureHeader: string): Promise<WebhookEvent>;
}

export interface NormalizedSubscription {
  id: string;
  customerId: string;
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface InvoiceSummary {
  id: string;
  subscriptionId: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  amountDueCents: number;
  amountPaidCents: number;
  hostedUrl?: string;
  periodStart?: Date;
  periodEnd?: Date;
  issuedAt?: Date;
  paidAt?: Date;
}

export interface PaymentMethodSummary {
  id: string;
  type: 'card' | 'bank_account' | 'other';
  brand?: string;
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
}

export interface WebhookEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: Date;
  id: string;
}

export class BillingProviderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BillingProviderError';
  }
}
