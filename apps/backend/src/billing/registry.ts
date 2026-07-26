// Billing provider descriptor registry. Mirrors the pattern from AI/mail/storage.
export interface BillingProviderDescriptor {
  id: string;
  name: string;
  docs: string;
}

export const BILLING_PROVIDERS: BillingProviderDescriptor[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    docs: 'https://stripe.com/docs',
  },
];

export function getBillingProviderDescriptor(id: string): BillingProviderDescriptor | undefined {
  return BILLING_PROVIDERS.find((p) => p.id === id);
}
