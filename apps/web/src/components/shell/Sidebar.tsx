'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FolderKanban } from 'lucide-react';
import { cn } from '@synora/design-system';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export interface SidebarProps {
  /** Shared with the mobile overlay: open = visible overlay on mobile, full-width column on desktop. */
  open: boolean;
  onNavigate: () => void;
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
];

export function Sidebar({ open, onNavigate }: SidebarProps): React.JSX.Element {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-hidden border-r border-border bg-card text-card-foreground transition-transform duration-300 md:relative md:z-auto md:translate-x-0 md:transition-all',
        open ? 'translate-x-0 md:w-64' : '-translate-x-full md:w-[68px]'
      )}
    >
      <div className="flex h-16 shrink-0 items-center border-b border-border px-4">
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2 font-bold text-primary">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
            S
          </span>
          {open && <span className="truncate text-lg">Synora</span>}
        </Link>
      </div>

      <div className="border-b border-border p-3">
        <WorkspaceSwitcher collapsed={!open} />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {open && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
