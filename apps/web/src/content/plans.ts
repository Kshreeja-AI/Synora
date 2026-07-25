/**
 * Pricing plan content. Typed data module — the M7 billing milestone
 * binds real subscription products to these same ids, so page copy and
 * billing stay one source of truth.
 */
export interface Plan {
  id: string;
  name: string;
  tagline: string;
  priceMonthly: number;
  priceYearlyPerMonth: number;
  popular: boolean;
  cta: string;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'For trying Synora and small personal projects.',
    priceMonthly: 0,
    priceYearlyPerMonth: 0,
    popular: false,
    cta: 'Start for free',
    features: [
      'Text & code generation',
      '1 workspace',
      '3 projects',
      'Community support',
      'Bring your own API key',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For creators shipping real work every day.',
    priceMonthly: 20,
    priceYearlyPerMonth: 16,
    popular: true,
    cta: 'Get started with Pro',
    features: [
      'Everything in Free',
      'Unlimited projects',
      'Image, video & audio generation (as released)',
      'Prompt library & generation history',
      'Priority support',
      'Usage analytics',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    tagline: 'For teams creating and reviewing together.',
    priceMonthly: 40,
    priceYearlyPerMonth: 32,
    popular: false,
    cta: 'Start a team',
    features: [
      'Everything in Pro',
      'Unlimited team members',
      'Shared workspaces & roles',
      'Team asset library',
      'Audit log',
      'SSO (coming with enterprise release)',
    ],
  },
];
