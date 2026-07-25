import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DashboardLayout from './layout';

vi.mock('../../hooks/useRequireAuth', () => ({
  useRequireAuth: vi.fn(),
}));

vi.mock('../../lib/api/auth', () => ({
  logout: vi.fn(),
}));

import { useRequireAuth } from '../../hooks/useRequireAuth';
import { logout } from '../../lib/api/auth';

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

describe('DashboardLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setViewportWidth(1024);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, href: '' },
    });
  });

  it('shows a loading state and withholds children while auth is resolving', () => {
    (useRequireAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(
      <DashboardLayout>
        <div>Protected content</div>
      </DashboardLayout>
    );

    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('renders the shell and children once authenticated', () => {
    (useRequireAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: true },
      isLoading: false,
    });

    render(
      <DashboardLayout>
        <div>Protected content</div>
      </DashboardLayout>
    );

    expect(screen.getByText('Protected content')).toBeDefined();
    expect(screen.getByText('Ada')).toBeDefined();
  });

  it('logs out and redirects home when Logout is clicked', async () => {
    (useRequireAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: true },
      isLoading: false,
    });
    (logout as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(
      <DashboardLayout>
        <div>Protected content</div>
      </DashboardLayout>
    );

    fireEvent.click(screen.getByRole('button', { name: /logout/i }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalled();
      expect(window.location.href).toBe('/');
    });
  });

  describe('mobile sidebar overlay', () => {
    beforeEach(() => {
      setViewportWidth(390);
      (useRequireAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { id: 'u1', email: 'ada@example.com', name: 'Ada', emailVerified: true },
        isLoading: false,
      });
    });

    it('starts closed on a narrow viewport, with no backdrop', () => {
      const { container } = render(
        <DashboardLayout>
          <div>Protected content</div>
        </DashboardLayout>
      );
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });

    it('opens as an overlay with a backdrop when toggled, and closes on backdrop click', () => {
      const { container } = render(
        <DashboardLayout>
          <div>Protected content</div>
        </DashboardLayout>
      );

      fireEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));
      const backdrop = container.querySelector('[aria-hidden="true"]');
      expect(backdrop).not.toBeNull();

      fireEvent.click(backdrop!);
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });

    it('closes the overlay after navigating to a sidebar link', () => {
      const { container } = render(
        <DashboardLayout>
          <div>Protected content</div>
        </DashboardLayout>
      );

      fireEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();

      fireEvent.click(screen.getByText('Settings'));
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });
  });
});
