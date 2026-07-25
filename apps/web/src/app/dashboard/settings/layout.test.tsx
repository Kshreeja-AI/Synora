import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsLayout from './layout';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/settings/account',
}));

describe('SettingsLayout', () => {
  it('renders the settings nav and children, marking the active section', () => {
    render(
      <SettingsLayout>
        <div>Account content</div>
      </SettingsLayout>
    );

    expect(screen.getByText('Account content')).toBeDefined();
    const accountLink = screen.getByRole('link', { name: 'Account' });
    expect(accountLink.getAttribute('aria-current')).toBe('page');
    const profileLink = screen.getByRole('link', { name: 'Profile' });
    expect(profileLink.getAttribute('aria-current')).toBeNull();
  });
});
