import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import { useCommandPaletteStore } from '../../stores/command-palette-store';
import { useKeyboardShortcutsStore } from '../../stores/keyboard-shortcuts-store';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../../hooks/useThemePreference', () => ({
  useThemePreference: vi.fn(),
}));
vi.mock('../../lib/api/auth', () => ({
  logout: vi.fn(),
}));

import { useThemePreference } from '../../hooks/useThemePreference';

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCommandPaletteStore.setState({ isOpen: false });
    useKeyboardShortcutsStore.setState({ isOpen: false });
    (useThemePreference as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      current: 'DARK',
      selectTheme: vi.fn(),
    });
  });

  it('toggles open with Cmd+K', () => {
    render(<CommandPalette />);
    expect(screen.queryByPlaceholderText(/search actions/i)).toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it('opens the keyboard shortcuts dialog with Cmd+/', () => {
    render(<CommandPalette />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true }));
    expect(useKeyboardShortcutsStore.getState().isOpen).toBe(true);
  });

  it('navigates and closes when a navigation item is selected', async () => {
    const user = userEvent.setup();
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);

    await user.click(screen.getByText('Dashboard'));

    expect(pushMock).toHaveBeenCalledWith('/dashboard');
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it('filters items as the user types', async () => {
    const user = userEvent.setup();
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);

    await user.type(screen.getByPlaceholderText(/search actions/i), 'workspace settings');

    expect(screen.getByText('Workspace settings')).toBeVisible();
    expect(screen.queryByText('Sessions')).not.toBeVisible();
  });

  it('calls selectTheme and closes when a theme action is selected', async () => {
    const user = userEvent.setup();
    const selectTheme = vi.fn();
    (useThemePreference as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ current: 'DARK', selectTheme });
    useCommandPaletteStore.setState({ isOpen: true });
    render(<CommandPalette />);

    await user.click(screen.getByText('Switch to light theme'));

    expect(selectTheme).toHaveBeenCalledWith('LIGHT');
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });
});
