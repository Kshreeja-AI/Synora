import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./Breadcrumbs', () => ({ Breadcrumbs: () => <div data-testid="breadcrumbs" /> }));
vi.mock('./NotificationsMenu', () => ({ NotificationsMenu: () => <div data-testid="notifications-menu" /> }));
vi.mock('./UserMenu', () => ({ UserMenu: () => <div data-testid="user-menu" /> }));

import { Topbar } from './Topbar';
import { useCommandPaletteStore } from '../../stores/command-palette-store';

describe('Topbar', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ isOpen: false });
  });

  it('calls onToggleSidebar when the toggle button is clicked', () => {
    const onToggleSidebar = vi.fn();
    render(<Topbar onToggleSidebar={onToggleSidebar} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it('opens the command palette when the search button is clicked', () => {
    render(<Topbar onToggleSidebar={vi.fn()} />);
    fireEvent.click(screen.getByText('Search...'));
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
  });

  it('renders breadcrumbs, notifications, and the user menu', () => {
    render(<Topbar onToggleSidebar={vi.fn()} />);
    expect(screen.getByTestId('breadcrumbs')).toBeDefined();
    expect(screen.getByTestId('notifications-menu')).toBeDefined();
    expect(screen.getByTestId('user-menu')).toBeDefined();
  });
});
