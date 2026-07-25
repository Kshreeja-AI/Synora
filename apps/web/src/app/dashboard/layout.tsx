'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@synora/design-system';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = (): void => {
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } relative overflow-hidden border-r border-border bg-card text-card-foreground transition-all duration-300`}
      >
        <div className="border-b border-border p-6">
          <h1 className={`text-2xl font-bold text-primary ${!sidebarOpen && 'hidden'}`}>Synora</h1>
        </div>

        <nav className="mt-8">
          <SidebarLink href="/dashboard" label="Dashboard" icon="📊" show={sidebarOpen} />
          <SidebarLink href="/dashboard/projects" label="Projects" icon="📁" show={sidebarOpen} />
          <SidebarLink href="/dashboard/create" label="Create" icon="➕" show={sidebarOpen} />
          <SidebarLink href="/dashboard/library" label="Library" icon="📚" show={sidebarOpen} />
          <SidebarLink href="/dashboard/settings" label="Settings" icon="⚙️" show={sidebarOpen} />
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
          <div className="text-sm text-muted-foreground">Welcome back!</div>
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
}: {
  href: string;
  label: string;
  icon: string;
  show: boolean;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 px-6 py-3 text-foreground transition-colors hover:bg-accent"
    >
      <span className="text-xl">{icon}</span>
      {show && <span>{label}</span>}
    </Link>
  );
}
