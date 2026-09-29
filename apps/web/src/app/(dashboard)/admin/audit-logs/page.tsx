'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { listAdminAuditLogs, type AdminAuditLog } from '@/lib/api/admin';

export default function AdminAuditLogsPage() {
  const [action, setAction] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'audit-logs', { action, workspaceId }],
    queryFn: () =>
      listAdminAuditLogs({
        action: action.trim() || undefined,
        workspaceId: workspaceId.trim() || undefined,
        limit: 100,
      }),
  });

  const logs: AdminAuditLog[] = data?.logs ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Audit logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cross-workspace audit trail. {data ? `${data.total} matching events` : 'Loading…'}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Filter by action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Action contains…"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <input
          aria-label="Filter by workspace id"
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          placeholder="Workspace id"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading audit logs…
        </div>
      ) : error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Could not load audit logs.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Workspace</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(l.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{l.action}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {l.targetType}
                    {l.targetId ? `:${l.targetId.slice(0, 8)}…` : ''}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{l.actorId.slice(0, 8)}…</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.workspaceId.slice(0, 8)}…</td>
                </tr>
              ))}
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    No audit events match those filters.
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
