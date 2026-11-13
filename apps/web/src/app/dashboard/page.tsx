'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Users,
  CalendarDays,
  Settings,
  Sparkles,
  MessageSquare,
  Bot,
  Wand2,
  ArrowUpRight,
  MailWarning,
} from 'lucide-react';
import { Button, Skeleton, EmptyState } from '@synora/design-system';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCurrentWorkspace } from '../../hooks/useCurrentWorkspace';
import { useCreateWorkspaceStore } from '../../stores/create-workspace-store';
import { resendVerificationEmail } from '../../lib/api/auth';
import { WhatsNew } from '../../components/shell/WhatsNew';
import { WaitingForYou } from '../../components/shell/WaitingForYou';
import { ActiveWork } from '../../components/shell/ActiveWork';
import { NeedsAttention } from '../../components/shell/NeedsAttention';
import { RecentActivity } from '../../components/shell/RecentActivity';
import { RecentConversations } from '../../components/shell/RecentConversations';

// Each of these opens a real surface. Nothing here is a metric: the page
// shows what you can do and what is actually happening, never a number
// invented to fill a card.
const QUICK_ACTIONS = [
  {
    href: '/command',
    icon: Sparkles,
    title: 'Ask Synora',
    body: 'Describe an outcome in a sentence and review the plan before it runs.',
  },
  {
    href: '/conversations',
    icon: MessageSquare,
    title: 'Start a conversation',
    body: 'Chat with a model, branch replies, and file threads into projects.',
  },
  {
    href: '/agents',
    icon: Bot,
    title: 'Run an agent',
    body: 'Hand a multi-step task to an agent and approve its steps.',
  },
  {
    href: '/studio',
    icon: Wand2,
    title: 'Open the studio',
    body: 'Generate images, audio and video from a prompt.',
  },
];

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
      <div className="space-y-8" role="status" aria-label="Loading dashboard">
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="h-5 w-64 max-w-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {!user.emailVerified && (
        <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center">
          <p className="flex items-center gap-2.5 text-sm text-foreground">
            <MailWarning className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            Please verify your email address to secure your account.
          </p>
          {resendStatus === 'sent' ? (
            <span role="status" className="text-sm font-medium text-success">
              Verification email sent.
            </span>
          ) : (
            <Button size="sm" variant="outline" loading={resendStatus === 'sending'} onClick={handleResend}>
              Resend verification email
            </Button>
          )}
        </div>
      )}

      <header className="mb-8">
        <p className="eyebrow mb-2">{currentWorkspace ? 'Overview' : 'Getting started'}</p>
        <h1 className="text-3xl font-semibold tracking-tightest text-foreground sm:text-[2.125rem]">
          Welcome, {user.name || user.email}
        </h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {currentWorkspace
            ? `Here's what's happening in ${currentWorkspace.name}.`
            : 'Create a workspace to get started.'}
        </p>
      </header>

      {!currentWorkspace ? (
        <EmptyState
          icon={<Building2 />}
          title="Create your first workspace"
          description="Workspaces keep your projects, members, and settings organized. You can create more later."
          action={<Button onClick={openCreateWorkspace}>Create workspace</Button>}
          className="bg-card"
        />
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="quick-actions-heading">
            <h2 id="quick-actions-heading" className="sr-only">
              Quick actions
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <li key={action.href}>
                    <Link href={action.href} className="surface-interactive group flex h-full flex-col p-4">
                      <span className="mb-3 flex items-center justify-between">
                        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-primary">
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <ArrowUpRight
                          className="h-4 w-4 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
                          aria-hidden
                        />
                      </span>
                      <span className="text-sm font-semibold text-foreground">{action.title}</span>
                      <span className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                        {action.body}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {/* Returning after time away starts with what happened while
                  you were gone — then what needs you. Absent on a first
                  visit and when nothing changed. */}
              <WhatsNew workspaceId={currentWorkspace.id} />

              {/* Ordered by how real the claim on attention is: blocked on a
                  decision only a person can make, then in progress right
                  now, then things that stopped on their own without being
                  asked to. Each of these is a fact — never a rank, a score,
                  or the platform inventing urgency about someone's work. */}
              <WaitingForYou workspaceId={currentWorkspace.id} />
              <ActiveWork workspaceId={currentWorkspace.id} />
              <NeedsAttention workspaceId={currentWorkspace.id} />

              {/* What merely happened, below what is blocked. History reads
                  when wanted; it never claims attention. */}
              <RecentActivity workspaceId={currentWorkspace.id} />
            </div>

            <div className="space-y-6">
              <RecentConversations workspaceId={currentWorkspace.id} />

              <section
                className="rounded-lg border border-border bg-card p-5 shadow-sm"
                aria-labelledby="workspace-heading"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-semibold text-primary">
                    {currentWorkspace.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h2 id="workspace-heading" className="truncate text-sm font-semibold text-foreground">
                      {currentWorkspace.name}
                    </h2>
                    <p className="truncate font-mono text-xs text-muted-foreground">/{currentWorkspace.slug}</p>
                  </div>
                </div>

                <dl className="mt-5 space-y-3 border-t border-border pt-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-4 w-4" aria-hidden />
                      Members
                    </dt>
                    <dd className="font-medium text-foreground">{currentWorkspace.memberCount}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-muted-foreground">
                      <Building2 className="h-4 w-4" aria-hidden />
                      Your role
                    </dt>
                    <dd className="font-medium text-foreground">{currentWorkspace.role}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-muted-foreground">
                      <CalendarDays className="h-4 w-4" aria-hidden />
                      Created
                    </dt>
                    <dd className="font-medium text-foreground">
                      {new Date(currentWorkspace.createdAt).toLocaleDateString()}
                    </dd>
                  </div>
                </dl>

                <Button asChild variant="outline" size="sm" className="mt-5 w-full">
                  <Link href="/dashboard/settings/workspace" className="gap-2">
                    <Settings className="h-4 w-4" aria-hidden />
                    Workspace settings
                  </Link>
                </Button>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
