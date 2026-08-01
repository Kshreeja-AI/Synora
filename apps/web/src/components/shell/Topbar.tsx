'use client';

import { PanelLeft, Search } from 'lucide-react';
import { Kbd } from '@synora/design-system';
import { Breadcrumbs } from './Breadcrumbs';
import { NotificationsMenu } from './NotificationsMenu';
import { UserMenu } from './UserMenu';
import { useCommandPaletteStore } from '../../stores/command-palette-store';

export interface TopbarProps {
  onToggleSidebar: () => void;
  onSearch?: () => void;
}

export function Topbar({ onToggleSidebar, onSearch }: TopbarProps): React.JSX.Element {
  const openPalette = useCommandPaletteStore((state) => state.open);

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <PanelLeft className="h-5 w-5" aria-hidden />
      </button>

      <div className="hidden md:block">
        <Breadcrumbs />
      </div>

      <button
        type="button"
        onClick={onSearch || openPalette}
        className="ml-auto flex w-full max-w-xs items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent sm:ml-4"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">Search...</span>
        <Kbd className="ml-auto hidden sm:inline-flex">⌘K</Kbd>
      </button>

      <div className="ml-auto flex items-center gap-1 sm:ml-3">
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  );
}
