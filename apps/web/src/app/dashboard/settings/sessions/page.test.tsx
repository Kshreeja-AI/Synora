import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SessionsSettingsPage from './page';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../../../../lib/api/sessions', () => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
}));
vi.mock('../../../../lib/api/auth', () => ({
  logoutEverywhere: vi.fn(),
}));

import { listSessions, revokeSession } from '../../../../lib/api/sessions';
import { logoutEverywhere } from '../../../../lib/api/auth';

const sessions = [
  {
    id: 'sess-current',
    createdAt: '2026-07-25T00:00:00.000Z',
    lastUsedAt: '2026-07-25T00:00:00.000Z',
    expiresAt: '2026-08-01T00:00:00.000Z',
    ipAddress: '127.0.0.1',
    deviceLabel: 'Chrome on Linux',
    rememberMe: false,
    isCurrent: true,
  },
  {
    id: 'sess-other',
    createdAt: '2026-07-24T00:00:00.000Z',
    lastUsedAt: '2026-07-24T00:00:00.000Z',
    expiresAt: '2026-08-24T00:00:00.000Z',
    ipAddress: '10.0.0.5',
    deviceLabel: 'Firefox on Windows',
    rememberMe: true,
    isCurrent: false,
  },
];

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('SessionsSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists sessions and marks the current one, without a revoke button for it', async () => {
    (listSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sessions);
    renderWithClient(<SessionsSettingsPage />);

    expect(await screen.findByText('Chrome on Linux')).toBeDefined();
    expect(screen.getByText('Firefox on Windows')).toBeDefined();
    expect(screen.getByText('This device')).toBeDefined();
    expect(screen.getByText('Remembered')).toBeDefined();

    // Only one revoke button — for the non-current session.
    expect(screen.getAllByRole('button', { name: /revoke/i })).toHaveLength(1);
  });

  it('revokes the other session', async () => {
    (listSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sessions);
    (revokeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ message: 'ok' });
    renderWithClient(<SessionsSettingsPage />);

    await screen.findByText('Firefox on Windows');
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }));

    await waitFor(() => {
      expect(revokeSession).toHaveBeenCalledWith('sess-other');
    });
  });

  it('shows an empty state with no sessions', async () => {
    (listSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderWithClient(<SessionsSettingsPage />);

    expect(await screen.findByText('No active sessions.')).toBeDefined();
  });

  it('logs out everywhere via the confirmation dialog', async () => {
    (listSessions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sessions);
    (logoutEverywhere as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    renderWithClient(<SessionsSettingsPage />);

    await screen.findByText('Chrome on Linux');
    fireEvent.click(screen.getByRole('button', { name: /log out of all devices/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^log out everywhere$/i }));

    await waitFor(() => {
      expect(logoutEverywhere).toHaveBeenCalled();
      expect(pushMock).toHaveBeenCalledWith('/auth/login');
    });
  });
});
