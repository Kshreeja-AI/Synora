'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles, BookOpen, Brain, FileText } from 'lucide-react';

const TABS = [
  { label: 'Prompts', href: '/knowledge/prompts', icon: Sparkles },
  { label: 'Templates', href: '/knowledge/templates', icon: BookOpen },
  { label: 'Memories', href: '/knowledge/memories', icon: Brain },
  { label: 'Files', href: '/knowledge/files', icon: FileText },
];

/**
 * Knowledge library tab bar. These are workspace-scoped surfaces but
 * not workspace-*routed* ones — the active workspace comes from
 * `useCurrentWorkspace`, so the hrefs are plain paths. (They previously
 * pointed at `/workspaces/${workspaceId}/knowledge/...`, a route that
 * has never existed, with a workspaceId that was always undefined.)
 */
export default function KnowledgeLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-6">
          <nav className="flex gap-8" aria-label="Knowledge tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-2 border-b-2 px-1 py-4 transition-colors ${
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
