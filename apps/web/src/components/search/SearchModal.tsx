'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@synora/design-system/components/Dialog';
import { SearchPanel } from './SearchPanel';

interface SearchModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SearchModal({ open = false, onOpenChange }: SearchModalProps) {
  const [isOpen, setIsOpen] = useState(open);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      // Escape to close
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[500px] max-w-2xl">
        <SearchPanel onClose={() => handleOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
