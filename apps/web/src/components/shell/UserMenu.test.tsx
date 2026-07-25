import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: vi.fn(),
}));
vi.mock('../../hooks/useThemePreference', () => ({
  useThemePreference: vi.fn(),
}));
vi.mock('../../lib/api/auth', () => ({
  logout: vi.fn(),
}));

import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useThemePreference } from '../../hooks/useThemePreference';
import { logout } from '../../lib/api/auth';
import { UserMenu } from './UserMenu';

const AUTHENTICATED_USER = { id: 'u1', email: 'ada@example.com', name: 'Ada', image: null };

describe('UserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useThemePreference as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      current: 'DARK',
      selectTheme: vi.fn(),
    });
  });

  it('renders nothing while the user is not yet loaded', () => {
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined });
    const { container } = render(<UserMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the user name and email in the menu', async () => {
    const user = userEvent.setup();
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: AUTHENTICATED_USER });
    render(<UserMenu />);

    await user.click(screen.getByRole('button', { name: /account menu/i }));

    expect(await screen.findByText('Ada')).toBeDefined();
    expect(screen.getByText('ada@example.com')).toBeDefined();
  });

  it('reveals the theme options on hover', async () => {
    const user = userEvent.setup();
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: AUTHENTICATED_USER });
    render(<UserMenu />);

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    await user.hover(await screen.findByText('Theme'));

    expect(await screen.findByText('Light')).toBeDefined();
    expect(screen.getByText('Dark')).toBeDefined();
    expect(screen.getByText('System')).toBeDefined();
  });

  it('logs out and redirects home', async () => {
    const user = userEvent.setup();
    (useCurrentUser as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: AUTHENTICATED_USER });
    (logout as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<UserMenu />);

    await user.click(screen.getByRole('button', { name: /account menu/i }));
    await user.click(await screen.findByText('Log out'));

    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
      expect(pushMock).toHaveBeenCalledWith('/');
    });
  });
});
