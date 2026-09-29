'use client';

import { useState, useCallback } from 'react';

export function useSearchDialog() {
  const [isOpen, setIsOpen] = useState(false);

  const openDialog = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
  }, []);

  // No ⌘K binding here on purpose: CommandPalette owns that shortcut
  // globally. Binding it in both places opened the palette and this dialog
  // on top of each other. The search dialog is opened from the Topbar
  // search control (and any caller of `openDialog`).

  return {
    isOpen,
    openDialog,
    closeDialog,
  };
}
