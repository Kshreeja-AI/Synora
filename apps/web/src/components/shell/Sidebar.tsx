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
  MessagesSquare,
  ArrowUpRight,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@synora/design-system';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { LogoMark } from '../brand/Logo';
import { useCurrentUser } from '../../hooks/useCurrentUser';

export interface SidebarProps {
  /** Shared with the mobile overlay: open = visible overlay on mobile, full-width column on desktop. */
  open: boolean;
  onNavigate: () => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  /** Omitted for the first group, which needs no heading. */
  heading?: string;
  items: NavItem[];
}

// Chat and the knowledge library live at the URL root (the `(dashboard)`
// route group) rather than under /dashboard; everything else is a
// /dashboard child. Both trees render inside the same AppShell.
//
// Grouped by what a person is trying to do rather than listed flat: sixteen
// equal-weight links ask the reader to scan all sixteen every time.
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      // Directly under Dashboard: asking for an outcome in a sentence is meant
      // to be the way in for someone who does not yet know which of the
      // surfaces below they need.
      { href: '/command', label: 'Ask Synora', icon: Sparkles },
      { href: '/conversations', label: 'Conversations', icon: MessageSquare },
      { href: '/search', label: 'Search', icon: Search },
    ],
  },
  {
    heading: 'Create',
    items: [
      { href: '/studio', label: 'Studio', icon: Wand2 },
      { href: '/canvas', label: 'Canvas', icon: LayoutGrid },
      { href: '/documents', label: 'Documents', icon: FileText },
    ],
  },
  {
    heading: 'Automate',
    items: [
      { href: '/agents', label: 'Agents', icon: Bot },
      { href: '/workflows', label: 'Workflows', icon: Workflow },
      { href: '/dashboard/tools', label: 'Tools', icon: Wrench },
      { href: '/plugins', label: 'Plugins', icon: Plug },
    ],
  },
  {
    heading: 'Organize',
    items: [
      { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
      { href: '/knowledge/prompts', label: 'Knowledge', icon: BookOpen },
    ],
  },
  {
    heading: 'Workspace',
    items: [
      { href: '/dashboard/usage', label: 'Usage', icon: BarChart3 },
      { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
      { href: '/developer', label: 'Developer', icon: Code2 },
    ],
  },
];

// Only rendered for ADMIN users — the pages behind it are separately
// server-gated, so hiding the entry is display hygiene, not security.
const ADMIN_NAV_ITEM: NavItem = { href: '/admin', label: 'Admin', icon: Shield };

/** Prefix used for the active-state check, where it differs from href. */
const ACTIVE_PREFIX: Record<string, string> = {
  '/knowledge/prompts': '/knowledge',
};

export function Sidebar({ open, onNavigate }: SidebarProps): React.JSX.Element {
  const pathname = usePathname();
  const { data: user } = useCurrentUser();

  const groups =
    user?.role === 'ADMIN'
      ? NAV_GROUPS.map((group, index) =>
          index === NAV_GROUPS.length - 1 ? { ...group, items: [...group.items, ADMIN_NAV_ITEM] } : group
        )
      : NAV_GROUPS;

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col overflow-hidden border-r border-border bg-card text-card-foreground transition-transform duration-300 ease-out-expo md:relative md:z-auto md:translate-x-0 md:transition-[width]',
        open ? 'translate-x-0 md:w-[248px]' : '-translate-x-full md:w-[64px]'
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center', open ? 'px-4' : 'justify-center px-0')}>
        <Link
          href="/dashboard"
          onClick={onNavigate}
          aria-label="Synora home"
          className="flex items-center gap-2.5 rounded-md"
        >
          <LogoMark className="h-7 w-7" />
          {open && <span className="truncate text-[15px] font-semibold tracking-tight">Synora</span>}
        </Link>
      </div>

      <div className={cn('pb-2', open ? 'px-3' : 'px-2')}>
        <WorkspaceSwitcher collapsed={!open} />
      </div>

      <nav className={cn('flex-1 overflow-y-auto pb-4', open ? 'px-3' : 'px-2')} aria-label="Primary">
        {groups.map((group, groupIndex) => (
          <div key={group.heading ?? 'main'} className={groupIndex === 0 ? 'pt-1' : 'pt-5'}>
            {group.heading &&
              (open ? (
                <p className="eyebrow px-2.5 pb-1.5">{group.heading}</p>
              ) : (
                <div aria-hidden className="mx-auto mb-2 h-px w-6 bg-border" />
              ))}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === '/dashboard'
                    ? pathname === item.href
                    : pathname.startsWith(ACTIVE_PREFIX[item.href] ?? item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      aria-label={item.label}
                      title={open ? undefined : item.label}
                      className={cn(
                        'group relative flex h-9 items-center gap-3 rounded-md text-[13.5px] font-medium transition-colors duration-150',
                        open ? 'px-2.5' : 'justify-center px-0',
                        active
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                      )}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-primary"
                        />
                      )}
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                        )}
                        aria-hidden
                      />
                      {open && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('shrink-0 border-t border-border py-3', open ? 'px-3' : 'px-2')}>
        <Link
          href="/assistant"
          onClick={onNavigate}
          aria-label="Open the Synora assistant"
          title={open ? undefined : 'Synora assistant'}
          className={cn(
            'group flex h-9 items-center gap-3 rounded-md text-[13.5px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent/60 hover:text-foreground',
            open ? 'px-2.5' : 'justify-center px-0'
          )}
        >
          <MessagesSquare className="h-4 w-4 shrink-0" aria-hidden />
          {open && (
            <>
              <span className="truncate">Assistant</span>
              <ArrowUpRight
                className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </>
          )}
        </Link>
      </div>
    </aside>
  );
}
