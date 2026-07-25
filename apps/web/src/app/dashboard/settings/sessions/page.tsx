'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Skeleton,
  toast,
} from '@synora/design-system';
import { listSessions, revokeSession } from '../../../../lib/api/sessions';
import { logoutEverywhere } from '../../../../lib/api/auth';
import { ApiError } from '../../../../lib/api/client';
import type { SessionResponse } from '../../../../lib/api/types';

function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function SessionRow({ session }: { session: SessionResponse }): React.JSX.Element {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => revokeSession(session.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      toast.success('Session revoked.');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to revoke session.');
    },
  });

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-0">
      <div>
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground">{session.deviceLabel}</p>
          {session.isCurrent && <Badge variant="secondary">This device</Badge>}
          {session.rememberMe && <Badge variant="outline">Remembered</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {session.ipAddress ?? 'Unknown location'} · Last active {formatRelativeTime(session.lastUsedAt)}
        </p>
      </div>
      {!session.isCurrent && (
        <Button variant="outline" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Revoke
        </Button>
      )}
    </div>
  );
}

export default function SessionsSettingsPage(): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: listSessions,
  });

  const logoutAllMutation = useMutation({
    mutationFn: logoutEverywhere,
    onSuccess: () => {
      queryClient.clear();
      router.push('/auth/login');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof ApiError ? err.message : 'Failed to log out of all devices.');
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Active sessions</h2>
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Log out of all devices
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Log out everywhere?</DialogTitle>
                  <DialogDescription>
                    This ends every active session, including this one. You&apos;ll need to sign in again.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    loading={logoutAllMutation.isPending}
                    onClick={() => logoutAllMutation.mutate()}
                  >
                    Log out everywhere
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {isLoading || !sessions ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            <div>
              {sessions.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
