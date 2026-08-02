'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@synora/design-system';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useSearchDialog } from '@/hooks/useSearchDialog';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { SearchDialog } from '../search/SearchDialog';
import { CommandPalette } from './CommandPalette';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';

const MOBILE_BREAKPOINT_PX = 768; // matches Tailwind's `md` breakpoint

export interface AppShellProps {
  children: React.ReactNode;
  /**
   * Padding for the content region. Standard pages want the default
   * gutter; full-bleed surfaces that bring their own chrome (the chat
   * view with its conversation rail, the knowledge pages with their tab
   * bar) pass `''` and manage their own spacing.
   */
  contentClassName?: string;
}

/**
 * The authenticated application shell: auth guard, sidebar, topbar, and
 * the global dialogs. Every signed-in surface renders inside this —
 * both the `/dashboard/*` tree and the `(dashboard)` route group — so
 * there is exactly one place where "you must be logged in to see this"
 * and "this is what the app frame looks like" are decided.
 */
export function AppShell({ children, contentClassName = 'p-6' }: AppShellProps): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { data: user, isLoading } = useRequireAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const {
    isOpen: isSearchOpen,
    openDialog: openSearch,
    closeDialog: closeSearch,
  } = useSearchDialog();

  // Below `md`, the sidebar becomes a full-height overlay rather than a
  // permanent column — defaulting it open there would cover the entire
  // viewport on first load with no visible content behind it, so it starts
  // closed on narrow screens only.
  useEffect(() => {
    if (window.innerWidth < MOBILE_BREAKPOINT_PX) {
      setSidebarOpen(false);
    }
  }, []);

  // On mobile the sidebar is a full-screen overlay, so picking a
  // destination should close it; on desktop it's a permanent column and
  // must stay exactly as the user left it (open or icon-only).
  const closeOverlayOnMobile = (): void => {
    if (window.innerWidth < MOBILE_BREAKPOINT_PX) {
      setSidebarOpen(false);
    }
  };

  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {sidebarOpen && (
        <div
          aria-hidden
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      )}

      <Sidebar open={sidebarOpen} onNavigate={closeOverlayOnMobile} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onToggleSidebar={() => setSidebarOpen((open) => !open)} onSearch={openSearch} />
        <main className="flex-1 overflow-auto">
          <div className={contentClassName || undefined}>{children}</div>
        </main>
      </div>

      {currentWorkspace && (
        <SearchDialog
          workspaceId={currentWorkspace.id}
          isOpen={isSearchOpen}
          onClose={closeSearch}
        />
      )}
      <CommandPalette />
      <KeyboardShortcutsDialog />
      <CreateWorkspaceDialog />
    </div>
  );
}
