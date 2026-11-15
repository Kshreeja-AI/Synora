'use client';

import { useEffect, useState } from 'react';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useSearchDialog } from '@/hooks/useSearchDialog';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { LogoMark } from '../brand/Logo';
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
export function AppShell({ children, contentClassName = 'mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8' }: AppShellProps): React.JSX.Element {
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
      <div
        role="status"
        aria-label="Loading your workspace"
        className="flex h-screen items-center justify-center bg-background"
      >
        <LogoMark className="h-10 w-10 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      {sidebarOpen && (
        <div
          aria-hidden
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
        />
      )}

      <Sidebar open={sidebarOpen} onNavigate={closeOverlayOnMobile} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar onToggleSidebar={() => setSidebarOpen((open) => !open)} onSearch={openSearch} />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto outline-none">
          <div className={contentClassName || 'h-full'}>{children}</div>
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
