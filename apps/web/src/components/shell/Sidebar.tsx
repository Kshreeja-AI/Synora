'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  BookOpen,
  FolderKanban,
  Wrench,
  BarChart3,
  Search,
  CreditCard,
  Code2,
  Shield,
  Wand2,
  Bot,
  Workflow,
  LayoutGrid,
  Plug,
  FileText,
  Sparkles,
} from 'lucide-react';
import { cn } from '@synora/design-system';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { useCurrentUser } from '../../hooks/useCurrentUser';

export interface SidebarProps {
  /** Shared with the mobile overlay: open = visible overlay on mobile, full-width column on desktop. */
  open: boolean;
  onNavigate: () => void;
}

// Chat and the knowledge library live at the URL root (the `(dashboard)`
// route group) rather than under /dashboard; everything else is a
// /dashboard child. Both trees render inside the same AppShell.
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  // Directly under Dashboard: asking for an outcome in a sentence is meant
  // to be the way in for someone who does not yet know which of the
  // surfaces below they need.
  { href: '/command', label: 'Ask Synora', icon: Sparkles },
  { href: '/conversations', label: 'Conversations', icon: MessageSquare },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/studio', label: 'Studio', icon: Wand2 },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/workflows', label: 'Workflows', icon: Workflow },
  { href: '/canvas', label: 'Canvas', icon: LayoutGrid },
  { href: '/knowledge/prompts', label: 'Knowledge', icon: BookOpen },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
  { href: '/dashboard/tools', label: 'Tools', icon: Wrench },
  { href: '/plugins', label: 'Plugins', icon: Plug },
  { href: '/dashboard/usage', label: 'Usage', icon: BarChart3 },
  { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
  { href: '/developer', label: 'Developer', icon: Code2 },
];

// Only rendered for ADMIN users — the pages behind it are separately
// server-gated, so hiding the entry is display hygiene, not security.
const ADMIN_NAV_ITEM = { href: '/admin', label: 'Admin', icon: Shield };

/** Prefix used for the active-state check, where it differs from href. */
const ACTIVE_PREFIX: Record<string, string> = {
  '/knowledge/prompts': '/knowledge',
};

export function Sidebar({ open, onNavigate }: SidebarProps): React.JSX.Element {
  const pathname = usePathname();
  const { data: user } = useCurrentUser();

  const navItems = user?.role === 'ADMIN' ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

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
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === '/dashboard'
              ? pathname === item.href
              : pathname.startsWith(ACTIVE_PREFIX[item.href] ?? item.href);
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
