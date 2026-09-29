'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { BarChart3, Users, Building2, ScrollText, Shield } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const TABS = [
  { label: 'Overview', href: '/admin', icon: BarChart3 },
  { label: 'Users', href: '/admin/users', icon: Users },
  { label: 'Workspaces', href: '/admin/workspaces', icon: Building2 },
  { label: 'Audit logs', href: '/admin/audit-logs', icon: ScrollText },
];

/**
 * Admin portal shell.
 *
 * Client-side role gate is a UX affordance, not a security boundary — every
 * admin API route is separately gated by requireAdminRole on the server, so
 * a non-admin who bypasses this component still gets 403s from the API.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: user, isLoading } = useCurrentUser();

  useEffect(() => {
    if (!isLoading && user && user.role !== 'ADMIN') {
      router.replace('/dashboard');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (user.role !== 'ADMIN') {
    return null;
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-border bg-background/50">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Shield className="h-4 w-4" /> Admin
          </div>
          <nav className="flex gap-6" aria-label="Admin tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive =
                tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex items-center gap-1.5 border-b-2 py-2 text-sm ${
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
