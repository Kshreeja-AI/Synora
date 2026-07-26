import Stripe from 'stripe';
import { BillingProvider, BillingProviderError, PaymentMethodSummary, WebhookEvent } from '../types.js';
import { PlaceholderSecretSource } from '../../secrets/sources/placeholder.js';

export class StripeProvider implements BillingProvider {
  private stripe: Stripe;
  private secretKey: string;
  private webhookSecret: string;

  constructor(config: { secretKey: string; webhookSecret: string }) {
    this.secretKey = config.secretKey;
    this.webhookSecret = config.webhookSecret;
    this.stripe = new Stripe(config.secretKey, { apiVersion: '2024-04-10' });
  }

  isConfigured(): boolean {
    const placeholder = PlaceholderSecretSource.generate('STRIPE_SECRET_KEY');
    const isPlaceholder = this.secretKey === placeholder;
    return !isPlaceholder && this.secretKey !== '';
  }

  async createCustomer(input: { workspaceId: string; email: string }): Promise<string> {
    try {
      const customer = await this.stripe.customers.create({
        email: input.email,
        metadata: { workspaceId: input.workspaceId },
      });
      return customer.id;
    } catch (error) {
      throw new BillingProviderError('CREATE_CUSTOMER_FAILED', `Failed to create Stripe customer: ${error}`);
    }
  }

  async createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        customer: input.customerId,
        payment_method_types: ['card'],
        line_items: [{ price: input.priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });

      if (!session.url) {
        throw new Error('No checkout URL returned');
      }

      return { url: session.url };
    } catch (error) {
      throw new BillingProviderError('CHECKOUT_FAILED', `Failed to create checkout session: ${error}`);
    }
  }

  async createSetupSession(input: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        customer: input.customerId,
        payment_method_types: ['card'],
        mode: 'setup',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });

      if (!session.url) {
        throw new Error('No setup URL returned');
      }

      return { url: session.url };
    } catch (error) {
      throw new BillingProviderError('SETUP_FAILED', `Failed to create setup session: ${error}`);
    }
  }

  async createBillingPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });

      return { url: session.url };
    } catch (error) {
      throw new BillingProviderError('PORTAL_FAILED', `Failed to create billing portal session: ${error}`);
    }
  }

  async updateSubscription(input: { subscriptionId: string; priceId: string }): Promise<void> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(input.subscriptionId);

      if (!subscription.items.data[0]) {
        throw new Error('No subscription items found');
      }

      await this.stripe.subscriptions.update(input.subscriptionId, {
        items: [{ id: subscription.items.data[0].id, price: input.priceId }],
      });
    } catch (error) {
      throw new BillingProviderError('UPDATE_SUBSCRIPTION_FAILED', `Failed to update subscription: ${error}`);
    }
  }

  async cancelSubscription(input: { subscriptionId: string; atPeriodEnd: boolean }): Promise<void> {
    try {
      if (input.atPeriodEnd) {
        await this.stripe.subscriptions.update(input.subscriptionId, { cancel_at_period_end: true });
      } else {
        await this.stripe.subscriptions.del(input.subscriptionId);
      }
    } catch (error) {
      throw new BillingProviderError('CANCEL_FAILED', `Failed to cancel subscription: ${error}`);
    }
  }

  async listPaymentMethods(input: { customerId: string }): Promise<PaymentMethodSummary[]> {
    try {
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: input.customerId,
        type: 'card',
      });

      return paymentMethods.data.map((pm) => ({
        id: pm.id,
        type: 'card',
        brand: pm.card?.brand,
        last4: pm.card?.last4,
        expiryMonth: pm.card?.exp_month,
        expiryYear: pm.card?.exp_year,
        isDefault: false,
      }));
    } catch (error) {
      throw new BillingProviderError('LIST_PAYMENT_METHODS_FAILED', `Failed to list payment methods: ${error}`);
    }
  }

  async removePaymentMethod(input: { paymentMethodId: string }): Promise<void> {
    try {
      await this.stripe.paymentMethods.detach(input.paymentMethodId);
    } catch (error) {
      throw new BillingProviderError('REMOVE_PAYMENT_METHOD_FAILED', `Failed to remove payment method: ${error}`);
    }
  }

  async verifyAndParseWebhookEvent(rawBody: Buffer, signatureHeader: string): Promise<WebhookEvent> {
    try {
      const event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret) as Stripe.Event;

      return {
        type: event.type,
        data: event.data.object as Record<string, unknown>,
        timestamp: new Date(event.created * 1000),
        id: event.id,
      };
    } catch (error) {
      throw new BillingProviderError('WEBHOOK_VERIFICATION_FAILED', `Webhook signature verification failed: ${error}`);
    }
  }
}
