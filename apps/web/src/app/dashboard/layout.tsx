'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Skeleton } from '@synora/design-system';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { logout } from '../../lib/api/auth';

const MOBILE_BREAKPOINT_PX = 768; // matches Tailwind's `md` breakpoint

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { data: user, isLoading } = useRequireAuth();

  // Below `md`, the sidebar becomes a full-height overlay (see className
  // below) rather than a permanent column — defaulting it open there would
  // cover the entire viewport on first load with no visible content behind
  // it, so it starts closed on narrow screens only.
  useEffect(() => {
    if (window.innerWidth < MOBILE_BREAKPOINT_PX) {
      setSidebarOpen(false);
    }
  }, []);

  const handleLogout = async (): Promise<void> => {
    await logout();
    window.location.href = '/';
  };

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
      {/* Below `md`, the sidebar is a fixed overlay (translated off-screen
          when closed) so it never squeezes page content into a sliver on a
          phone-width viewport; at `md` and up it's a permanent column that
          only changes width (icon-only when collapsed). */}
      {sidebarOpen && (
        <div
          aria-hidden
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 overflow-hidden border-r border-border bg-card text-card-foreground transition-transform duration-300 md:relative md:z-auto md:translate-x-0 md:transition-all ${
          sidebarOpen ? 'translate-x-0 md:w-64' : '-translate-x-full md:w-20'
        }`}
      >
        <div className="border-b border-border p-6">
          <h1 className={`text-2xl font-bold text-primary ${!sidebarOpen && 'md:hidden'}`}>Synora</h1>
        </div>

        <nav className="mt-8">
          <SidebarLink href="/dashboard" label="Dashboard" icon="📊" show={sidebarOpen} onNavigate={closeOverlayOnMobile} />
          <SidebarLink href="/dashboard/projects" label="Projects" icon="📁" show={sidebarOpen} onNavigate={closeOverlayOnMobile} />
          <SidebarLink href="/dashboard/create" label="Create" icon="➕" show={sidebarOpen} onNavigate={closeOverlayOnMobile} />
          <SidebarLink href="/dashboard/library" label="Library" icon="📚" show={sidebarOpen} onNavigate={closeOverlayOnMobile} />
          <SidebarLink href="/dashboard/settings" label="Settings" icon="⚙️" show={sidebarOpen} onNavigate={closeOverlayOnMobile} />
        </nav>

        <div className="absolute bottom-0 left-0 right-0 border-t border-border p-4">
          <Button variant="danger" size="sm" className="w-full" onClick={handleLogout}>
            {sidebarOpen ? 'Logout' : '🚪'}
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            ☰
          </button>
          <div className="text-sm text-muted-foreground">{user.name || user.email}</div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarLink({
  href,
  label,
  icon,
  show,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: string;
  show: boolean;
  onNavigate: () => void;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-4 px-6 py-3 text-foreground transition-colors hover:bg-accent"
    >
      <span className="text-xl">{icon}</span>
      {show && <span>{label}</span>}
    </Link>
  );
}
