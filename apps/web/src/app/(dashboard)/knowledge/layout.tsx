'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { Sparkles, BookOpen } from 'lucide-react';

export default function KnowledgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  const tabs = [
    {
      label: 'Prompts',
      href: `/workspaces/${workspaceId}/knowledge/prompts`,
      icon: Sparkles,
    },
    {
      label: 'Templates',
      href: `/workspaces/${workspaceId}/knowledge/templates`,
      icon: BookOpen,
    },
  ];

  return (
    <>
      <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-8" aria-label="Knowledge tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = pathname.includes(tab.label.toLowerCase());
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex items-center gap-2 px-1 py-4 border-b-2 transition-colors ${
                    isActive
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      {children}
    </>
  );
}
