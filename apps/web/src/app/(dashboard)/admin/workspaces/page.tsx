'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { listAdminWorkspaces, type AdminWorkspace } from '@/lib/api/admin';

export default function AdminWorkspacesPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'workspaces', { search }],
    queryFn: () => listAdminWorkspaces({ search: search.trim() || undefined, limit: 100 }),
  });

  const workspaces: AdminWorkspace[] = data?.workspaces ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data ? `${data.total} total` : 'Loading…'}
        </p>
      </header>

      <div className="relative max-w-md">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          aria-label="Search workspaces"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or slug…"
          className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading workspaces…
        </div>
      ) : error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Could not load workspaces.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Workspace</th>
                <th className="px-3 py-2">Members</th>
                <th className="px-3 py-2">Conversations</th>
                <th className="px-3 py-2">Projects</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{w.name}</div>
                    <div className="text-xs text-muted-foreground">/{w.slug}</div>
                  </td>
                  <td className="px-3 py-2">{w._count.members}</td>
                  <td className="px-3 py-2">{w._count.conversations}</td>
                  <td className="px-3 py-2">{w._count.projects}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(w.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {workspaces.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    No workspaces yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
