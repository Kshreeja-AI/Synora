import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarketingNav } from './MarketingNav';

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', setTheme: vi.fn() }),
}));

describe('MarketingNav', () => {
  it('renders the primary navigation links', () => {
    render(<MarketingNav />);
    expect(screen.getAllByRole('link', { name: 'Pricing' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Changelog' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);
  });

  it('toggles the mobile menu', () => {
    render(<MarketingNav />);
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Close menu' }).getAttribute('aria-expanded')
    ).toBe('true');
  });
});
