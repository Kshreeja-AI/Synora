import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let pathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

import { Breadcrumbs } from './Breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders a single crumb for the dashboard root', () => {
    pathname = '/dashboard';
    render(<Breadcrumbs />);
    expect(screen.getByText('Dashboard')).toHaveAttribute('aria-current', 'page');
  });

  it('renders a full trail with links for nested routes', () => {
    pathname = '/dashboard/settings/profile';
    render(<Breadcrumbs />);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/dashboard/settings');
    expect(screen.getByText('Profile')).toHaveAttribute('aria-current', 'page');
  });
});
