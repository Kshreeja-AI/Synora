import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanCard } from './PlanCard';
import type { Plan } from '../../content/plans';

const plan: Plan = {
  id: 'pro',
  name: 'Pro',
  tagline: 'For creators.',
  priceMonthly: 20,
  priceYearlyPerMonth: 16,
  popular: true,
  cta: 'Get Pro',
  features: ['Everything in Free', 'Unlimited projects'],
};

describe('PlanCard', () => {
  it('renders name, price, features, and CTA', () => {
    render(<PlanCard plan={plan} />);
    expect(screen.getByText('Pro')).toBeDefined();
    expect(screen.getByText('$20')).toBeDefined();
    expect(screen.getByText('Unlimited projects')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Get Pro' }).getAttribute('href')).toBe(
      '/auth/register'
    );
  });

  it('shows the popular badge only when popular', () => {
    const { rerender } = render(<PlanCard plan={plan} />);
    expect(screen.getByText('Most popular')).toBeDefined();
    rerender(<PlanCard plan={{ ...plan, popular: false }} />);
    expect(screen.queryByText('Most popular')).toBeNull();
  });
});
