'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, ShieldOff, ShieldCheck, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@synora/design-system';
import {
  listAdminUsers,
  reactivateAdminUser,
  suspendAdminUser,
  type AdminUser,
} from '@/lib/api/admin';

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'text-emerald-500',
  SUSPENDED: 'text-amber-500',
  DELETED: 'text-destructive',
};

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'SUSPENDED' | 'DELETED'>('');
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'users', { search, status }],
    queryFn: () =>
      listAdminUsers({
        search: search.trim() || undefined,
        status: status || undefined,
        limit: 100,
      }),
  });

  const suspend = useMutation({
    mutationFn: (userId: string) => suspendAdminUser(userId),
    onSuccess: (u) => {
      toast.success(`Suspended ${u.email}`);
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to suspend user'),
  });

  const reactivate = useMutation({
    mutationFn: (userId: string) => reactivateAdminUser(userId),
    onSuccess: (u) => {
      toast.success(`Reactivated ${u.email}`);
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to reactivate user'),
  });

  const users: AdminUser[] = data?.users ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data ? `${data.total} total` : 'Loading…'}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email or name…"
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm"
          />
        </div>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="rounded-md border border-input bg-background px-2 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DELETED">Deleted</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading users…
        </div>
      ) : error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Could not load users.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Workspaces</th>
                <th className="px-3 py-2">Joined</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{u.name || u.email}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3" /> {u.email}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                      {u.role}
                    </span>
                  </td>
                  <td className={`px-3 py-2 ${STATUS_COLOR[u.status] ?? ''}`}>{u.status}</td>
                  <td className="px-3 py-2">{u._count.workspaces}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {u.status === 'ACTIVE' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={suspend.isPending || u.role === 'ADMIN'}
                        title={u.role === 'ADMIN' ? 'Cannot suspend another admin' : 'Suspend user'}
                        onClick={() => suspend.mutate(u.id)}
                      >
                        <ShieldOff className="mr-1 h-3 w-3" /> Suspend
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={reactivate.isPending}
                        onClick={() => reactivate.mutate(u.id)}
                      >
                        <ShieldCheck className="mr-1 h-3 w-3" /> Reactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    No users match those filters.
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
