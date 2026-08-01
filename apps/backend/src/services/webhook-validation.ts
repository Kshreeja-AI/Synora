import { z } from 'zod';

const CheckoutSessionSchema = z.object({
  subscription: z.string().min(1, 'Subscription ID is required'),
  customer: z.string().min(1, 'Customer ID is required'),
});

const SubscriptionSchema = z.object({
  id: z.string().min(1, 'Subscription ID is required'),
  status: z.enum(['active', 'past_due', 'canceled', 'trialing']),
  current_period_start: z.number(),
  current_period_end: z.number(),
});

const InvoiceSchema = z.object({
  id: z.string().min(1, 'Invoice ID is required'),
  subscription: z.string().min(1, 'Subscription ID is required'),
  amount_paid: z.number().optional(),
  amount_due: z.number().optional(),
  hosted_invoice_url: z.string().optional(),
});

const PaymentMethodSchema = z.object({
  id: z.string().min(1, 'Payment method ID is required'),
  customer: z.string().min(1, 'Customer ID is required'),
  type: z.string().optional(),
  card: z.object({
    brand: z.string().optional(),
    last4: z.string().optional(),
    exp_month: z.number().optional(),
    exp_year: z.number().optional(),
  }).optional(),
});

const PaymentMethodDetachedSchema = z.object({
  id: z.string().min(1, 'Payment method ID is required'),
});

export const webhookSchemas = {
  'checkout.session.completed': CheckoutSessionSchema,
  'customer.subscription.updated': SubscriptionSchema,
  'customer.subscription.deleted': SubscriptionSchema,
  'invoice.paid': InvoiceSchema,
  'invoice.payment_failed': InvoiceSchema,
  'payment_method.attached': PaymentMethodSchema,
  'payment_method.detached': PaymentMethodDetachedSchema,
} as const;

export type WebhookEventType = keyof typeof webhookSchemas;

export function validateWebhookData(eventType: string, data: unknown): data is Record<string, unknown> {
  const schema = webhookSchemas[eventType as WebhookEventType];
  if (!schema) {
    return true;
  }

  try {
    schema.parse(data);
    return true;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Webhook validation failed: ${error.errors.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
}
