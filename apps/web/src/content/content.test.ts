import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { PLANS } from './plans';
import { FEATURES, getFeature } from './features';
import { CHANGELOG } from './changelog';

// Schema-validate the content modules so a malformed entry fails CI,
// not production.

const planSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().min(1),
  priceMonthly: z.number().nonnegative(),
  priceYearlyPerMonth: z.number().nonnegative(),
  popular: z.boolean(),
  cta: z.string().min(1),
  features: z.array(z.string().min(1)).min(1),
});

const featureSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  icon: z.string().min(1),
  title: z.string().min(1),
  tagline: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(['available', 'coming-soon']),
  sections: z
    .array(z.object({ heading: z.string().min(1), body: z.string().min(1) }))
    .min(1),
});

const changelogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1),
  tag: z.enum(['release', 'feature', 'improvement', 'fix']),
  description: z.string().min(1),
  highlights: z.array(z.string().min(1)).min(1),
});

describe('content modules', () => {
  it('every plan is valid and exactly one is popular', () => {
    for (const plan of PLANS) planSchema.parse(plan);
    expect(PLANS.filter((p) => p.popular)).toHaveLength(1);
    expect(new Set(PLANS.map((p) => p.id)).size).toBe(PLANS.length);
  });

  it('every feature is valid with a unique slug', () => {
    for (const feature of FEATURES) featureSchema.parse(feature);
    expect(new Set(FEATURES.map((f) => f.slug)).size).toBe(FEATURES.length);
  });

  it('getFeature resolves known slugs and rejects unknown ones', () => {
    expect(getFeature('text-generation')?.title).toBe('Text Generation');
    expect(getFeature('does-not-exist')).toBeUndefined();
  });

  it('every changelog entry is valid and sorted newest-first', () => {
    for (const entry of CHANGELOG) changelogSchema.parse(entry);
    const dates = CHANGELOG.map((e) => e.date);
    const sorted = [...dates].sort((a, b) => (a < b ? 1 : -1));
    expect(dates).toEqual(sorted);
  });
});
