import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { useKeyboardShortcutsStore } from '../../stores/keyboard-shortcuts-store';

describe('KeyboardShortcutsDialog', () => {
  beforeEach(() => {
    useKeyboardShortcutsStore.setState({ isOpen: false });
  });

  it('is not visible when the store is closed', () => {
    render(<KeyboardShortcutsDialog />);
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull();
  });

  it('shows the shortcuts list when the store is open', () => {
    useKeyboardShortcutsStore.setState({ isOpen: true });
    render(<KeyboardShortcutsDialog />);
    expect(screen.getByText('Keyboard shortcuts')).toBeDefined();
    expect(screen.getByText('Open the command palette')).toBeDefined();
  });
});
