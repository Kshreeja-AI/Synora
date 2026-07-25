'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Kbd } from '@synora/design-system';
import { useKeyboardShortcutsStore } from '../../stores/keyboard-shortcuts-store';

const SHORTCUTS: Array<{ keys: string[]; description: string }> = [
  { keys: ['⌘', 'K'], description: 'Open the command palette' },
  { keys: ['⌘', '/'], description: 'Show this shortcuts list' },
  { keys: ['↑', '↓'], description: 'Move through command palette results' },
  { keys: ['↵'], description: 'Select the highlighted result' },
  { keys: ['Esc'], description: 'Close the open dialog or menu' },
];

export function KeyboardShortcutsDialog(): React.JSX.Element {
  const isOpen = useKeyboardShortcutsStore((state) => state.isOpen);
  const close = useKeyboardShortcutsStore((state) => state.close);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Move around Synora without touching the mouse.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.description} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{shortcut.description}</span>
              <span className="flex gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
