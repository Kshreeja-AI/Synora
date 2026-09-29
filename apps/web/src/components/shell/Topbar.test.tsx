import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('./Breadcrumbs', () => ({ Breadcrumbs: () => <div data-testid="breadcrumbs" /> }));
vi.mock('./NotificationsMenu', () => ({ NotificationsMenu: () => <div data-testid="notifications-menu" /> }));
vi.mock('./UserMenu', () => ({ UserMenu: () => <div data-testid="user-menu" /> }));

import { Topbar } from './Topbar';
import { useCommandPaletteStore } from '../../stores/command-palette-store';

describe('Topbar', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ isOpen: false });
    pushMock.mockReset();
  });

  it('calls onToggleSidebar when the toggle button is clicked', () => {
    const onToggleSidebar = vi.fn();
    render(<Topbar onToggleSidebar={onToggleSidebar} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it('navigates to /search with the query when the input is submitted', () => {
    render(<Topbar onToggleSidebar={vi.fn()} />);
    // Type + submit — this is the "hit Enter, land on results page" flow.
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), {
      target: { value: 'launch plan' },
    });
    fireEvent.submit(screen.getByRole('search'));
    expect(pushMock).toHaveBeenCalledWith('/search?q=launch%20plan');
  });

  it('opens the command palette on empty submit rather than navigating', () => {
    render(<Topbar onToggleSidebar={vi.fn()} />);
    // An empty submit falls back to the palette so the input is not a
    // dead-end when the user just hits Enter with no query.
    fireEvent.submit(screen.getByRole('search'));
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('still supports the legacy onSearch button prop for callers that pass it', () => {
    const onSearch = vi.fn();
    render(<Topbar onToggleSidebar={vi.fn()} onSearch={onSearch} />);
    fireEvent.click(screen.getByText('Search...'));
    expect(onSearch).toHaveBeenCalled();
  });

  it('renders breadcrumbs, notifications, and the user menu', () => {
    render(<Topbar onToggleSidebar={vi.fn()} />);
    expect(screen.getByTestId('breadcrumbs')).toBeDefined();
    expect(screen.getByTestId('notifications-menu')).toBeDefined();
    expect(screen.getByTestId('user-menu')).toBeDefined();
  });
});
