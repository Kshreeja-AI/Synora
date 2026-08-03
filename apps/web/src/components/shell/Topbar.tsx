'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PanelLeft, Search } from 'lucide-react';
import { Kbd } from '@synora/design-system';
import { Breadcrumbs } from './Breadcrumbs';
import { NotificationsMenu } from './NotificationsMenu';
import { UserMenu } from './UserMenu';
import { useCommandPaletteStore } from '../../stores/command-palette-store';

export interface TopbarProps {
  onToggleSidebar: () => void;
  /** Legacy hook for callers that still want to override the search click.
   *  When set, replaces the input with a click-through button that fires it. */
  onSearch?: () => void;
}

export function Topbar({ onToggleSidebar, onSearch }: TopbarProps): React.JSX.Element {
  const openPalette = useCommandPaletteStore((state) => state.open);
  const router = useRouter();
  const [query, setQuery] = useState('');

  // Command palette (⌘K) is preserved as the fast jump-nav path. This input
  // is the "type + Enter → full results" flow: the palette is for jumping to
  // known items, this is for searching across the workspace and browsing
  // the matches on a shareable URL.
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      openPalette();
      return;
    }
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

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

      {onSearch ? (
        <button
          type="button"
          onClick={onSearch}
          className="ml-auto flex w-full max-w-xs items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent sm:ml-4"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">Search...</span>
          <Kbd className="ml-auto hidden sm:inline-flex">⌘K</Kbd>
        </button>
      ) : (
        <form
          role="search"
          onSubmit={submit}
          className="ml-auto flex w-full max-w-xs items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm transition-colors focus-within:border-primary/60 sm:ml-4"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            aria-label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="min-w-0 flex-1 bg-transparent text-muted-foreground placeholder:text-muted-foreground focus:text-foreground focus:outline-none"
          />
          <Kbd className="ml-auto hidden shrink-0 sm:inline-flex">⌘K</Kbd>
        </form>
      )}

      <div className="ml-auto flex items-center gap-1 sm:ml-3">
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  );
}
