import { getConfig } from '../config/index.js';
import { secretsManager } from '../secrets/index.js';
import { getBillingProviderDescriptor } from './registry.js';
import { BillingProvider, BillingProviderError } from './types.js';
import { StripeProvider } from './providers/stripe.provider.js';

let cachedProvider: BillingProvider | null = null;

export async function resolveBillingProvider(): Promise<BillingProvider> {
  if (cachedProvider) {
    return cachedProvider;
  }

  const config = getConfig();
  const providerId = config.billing.provider;

  const descriptor = getBillingProviderDescriptor(providerId);
  if (!descriptor) {
    throw new BillingProviderError('UNKNOWN_PROVIDER', `Unknown billing provider: ${providerId}`);
  }

  let provider: BillingProvider;

  if (providerId === 'stripe') {
    const secretKey = await secretsManager.get('STRIPE_SECRET_KEY');
    const webhookSecret = await secretsManager.get('STRIPE_WEBHOOK_SECRET');
    // Provenance travels with the values: in development both resolve to
    // generated placeholders (so the provider constructs and billing routes
    // answer honestly instead of crashing), but only REAL values may make
    // isConfigured() claim Stripe can actually be charged against.
    const hasRealCredentials =
      (await secretsManager.hasReal('STRIPE_SECRET_KEY')) &&
      (await secretsManager.hasReal('STRIPE_WEBHOOK_SECRET'));

    provider = new StripeProvider({
      secretKey,
      webhookSecret,
      hasRealCredentials,
    });
  } else {
    throw new BillingProviderError('UNSUPPORTED_PROVIDER', `Billing provider not yet implemented: ${providerId}`);
  }

  cachedProvider = provider;
  return provider;
}

export function clearBillingProviderCache(): void {
  cachedProvider = null;
}
