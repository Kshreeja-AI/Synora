'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@synora/design-system';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace';
import { useSearchDialog } from '../../hooks/useSearchDialog';
import { Sidebar } from '../../components/shell/Sidebar';
import { Topbar } from '../../components/shell/Topbar';
import { SearchDialog } from '../../components/search/SearchDialog';
import { CommandPalette } from '../../components/shell/CommandPalette';
import { KeyboardShortcutsDialog } from '../../components/shell/KeyboardShortcutsDialog';
import { CreateWorkspaceDialog } from '../../components/shell/CreateWorkspaceDialog';

const MOBILE_BREAKPOINT_PX = 768; // matches Tailwind's `md` breakpoint

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { data: user, isLoading } = useRequireAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const { isOpen: isSearchOpen, openDialog: openSearch, closeDialog: closeSearch } = useSearchDialog();

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
          <div className="p-6">{children}</div>
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
