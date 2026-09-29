import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardLayout from './layout';

vi.mock('../../hooks/useRequireAuth', () => ({
  useRequireAuth: vi.fn(),
}));

// The shell's sub-components each own real data-fetching (workspaces,
// notifications, current user) that's already covered by their own unit
// tests. Stubbing them here keeps this file focused on what the layout
// itself is responsible for: the auth gate and the mobile overlay behavior.
vi.mock('../../components/shell/Sidebar', () => ({
  Sidebar: ({ open, onNavigate }: { open: boolean; onNavigate: () => void }) => (
    <div data-testid="sidebar" data-open={open}>
      <button onClick={onNavigate}>Dashboard</button>
    </div>
  ),
}));
vi.mock('../../components/shell/Topbar', () => ({
  Topbar: ({ onToggleSidebar }: { onToggleSidebar: () => void }) => (
    <button aria-label="Toggle sidebar" onClick={onToggleSidebar}>
      Toggle
    </button>
  ),
}));
vi.mock('../../components/shell/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../components/shell/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../components/shell/CreateWorkspaceDialog', () => ({ CreateWorkspaceDialog: () => null }));
vi.mock('../../components/search/SearchDialog', () => ({ SearchDialog: () => null }));
vi.mock('../../hooks/useSearchDialog', () => ({
  useSearchDialog: () => ({
    isOpen: false,
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
  }),
}));

import { useRequireAuth } from '../../hooks/useRequireAuth';

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

describe('DashboardLayout', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    setViewportWidth(1024);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderWithQueryClient = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    );
  };

  it('shows a loading state and withholds children while auth is resolving', () => {
    (useRequireAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    renderWithQueryClient(
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

    renderWithQueryClient(
      <DashboardLayout>
        <div>Protected content</div>
      </DashboardLayout>
    );

    expect(screen.getByText('Protected content')).toBeDefined();
    expect(screen.getByTestId('sidebar')).toBeDefined();
    expect(screen.getByRole('button', { name: /toggle sidebar/i })).toBeDefined();
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
      const { container } = renderWithQueryClient(
        <DashboardLayout>
          <div>Protected content</div>
        </DashboardLayout>
      );
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');
    });

    it('opens as an overlay with a backdrop when toggled, and closes on backdrop click', () => {
      const { container } = renderWithQueryClient(
        <DashboardLayout>
          <div>Protected content</div>
        </DashboardLayout>
      );

      fireEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));
      const backdrop = container.querySelector('[aria-hidden="true"]');
      expect(backdrop).not.toBeNull();
      expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'true');

      fireEvent.click(backdrop!);
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });

    it('closes the overlay after navigating from the sidebar', () => {
      const { container } = renderWithQueryClient(
        <DashboardLayout>
          <div>Protected content</div>
        </DashboardLayout>
      );

      fireEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();

      fireEvent.click(screen.getByText('Dashboard'));
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });
  });
});
