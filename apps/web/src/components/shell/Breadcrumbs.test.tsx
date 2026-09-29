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

  it('names a page the same way the navigation does', () => {
    // Found by opening the app in a browser: the sidebar said "Ask Synora"
    // and the breadcrumb said "Command" for the same page. Two names for one
    // place quietly teaches that they are two places.
    pathname = '/command';
    render(<Breadcrumbs />);
    expect(screen.getByText('Ask Synora')).toHaveAttribute('aria-current', 'page');
  });
});
