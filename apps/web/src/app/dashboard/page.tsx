'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Users, CalendarDays, Settings } from 'lucide-react';
import { Button, Card, CardContent, Skeleton, EmptyState } from '@synora/design-system';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace';
import { useCreateWorkspaceStore } from '../../stores/create-workspace-store';
import { resendVerificationEmail } from '../../lib/api/auth';
import { WaitingForYou } from '../../components/shell/WaitingForYou';

export default function DashboardPage(): React.JSX.Element {
  const router = useRouter();
  const { data: user, isLoading: isUserLoading } = useCurrentUser();
  const { currentWorkspace, isLoading: isWorkspaceLoading } = useCurrentWorkspace();
  const openCreateWorkspace = useCreateWorkspaceStore((state) => state.open);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  // First-run redirect: send users who have never completed the welcome flow
  // to /welcome. This is a UX affordance, not a security boundary — anyone
  // who bypasses it still sees the same dashboard, they just don't get the
  // guided setup.
  useEffect(() => {
    if (!isUserLoading && user && user.onboardedAt === null) {
      router.replace('/welcome');
    }
  }, [user, isUserLoading, router]);

  const handleResend = async (): Promise<void> => {
    setResendStatus('sending');
    try {
      await resendVerificationEmail();
      setResendStatus('sent');
    } catch {
      setResendStatus('idle');
    }
  };

  if (isUserLoading || !user || isWorkspaceLoading) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-5 w-72" />
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div>
      {!user.emailVerified && (
        <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            Please verify your email address to secure your account.
          </p>
          {resendStatus === 'sent' ? (
            <span className="text-sm font-medium text-success">Verification email sent.</span>
          ) : (
            <Button size="sm" variant="outline" loading={resendStatus === 'sending'} onClick={handleResend}>
              Resend verification email
            </Button>
          )}
        </div>
      )}

      <h1 className="mb-2 text-4xl font-bold text-foreground">Welcome, {user.name || user.email}!</h1>
      <p className="mb-8 text-muted-foreground">
        {currentWorkspace ? `Here's what's happening in ${currentWorkspace.name}.` : 'Create a workspace to get started.'}
      </p>

      {!currentWorkspace ? (
        <EmptyState
          icon={<Building2 />}
          title="Create your first workspace"
          description="Workspaces keep your projects, members, and settings organized. You can create more later."
          action={<Button onClick={openCreateWorkspace}>Create workspace</Button>}
        />
      ) : (
        <div className="space-y-6">
          {/* What is actually blocked on this person, before anything
              else on the page. A paused run is a fact, not a guess about
              what might matter. */}
          <WaitingForYou workspaceId={currentWorkspace.id} />

          <Card>
          <CardContent className="space-y-6 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg font-semibold text-primary">
                {currentWorkspace.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-semibold text-foreground">{currentWorkspace.name}</h2>
                <p className="text-sm text-muted-foreground">/{currentWorkspace.slug}</p>
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-4 border-t border-border pt-6 sm:grid-cols-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
                <div>
                  <dt className="text-xs text-muted-foreground">Members</dt>
                  <dd className="text-sm font-medium text-foreground">{currentWorkspace.memberCount}</dd>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                <div>
                  <dt className="text-xs text-muted-foreground">Your role</dt>
                  <dd className="text-sm font-medium text-foreground">{currentWorkspace.role}</dd>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
                <div>
                  <dt className="text-xs text-muted-foreground">Created</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {new Date(currentWorkspace.createdAt).toLocaleDateString()}
                  </dd>
                </div>
              </div>
            </dl>

            <div className="border-t border-border pt-6">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/settings/workspace" className="gap-2">
                  <Settings className="h-4 w-4" aria-hidden />
                  Workspace settings
                </Link>
              </Button>
            </div>
          </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
