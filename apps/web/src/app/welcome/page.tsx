'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles,
  Building2,
  User as UserIcon,
  MessagesSquare,
  ArrowRight,
  Check,
  Loader2,
} from 'lucide-react';
import { Button, Card, CardContent } from '@synora/design-system';
import { toast } from 'sonner';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { markOnboarded, updateProfile } from '@/lib/api/account';
import { createWorkspace } from '@/lib/api/workspaces';
import { useQueryClient } from '@tanstack/react-query';

/**
 * First-run onboarding flow.
 *
 * A signed-in user with no workspace and no onboardedAt gets routed here
 * (see the dashboard router-side redirect). Three focused steps:
 *   1. Create a workspace (the platform's smallest useful unit — required)
 *   2. Set display name and short profile (optional but strongly encouraged)
 *   3. Land in a first conversation (either the button starts one, or the
 *      user hits "Explore instead" to go straight to the dashboard)
 *
 * "Skip" is deliberately allowed on every step. Marking a user onboarded
 * means "they were shown the door" — not "they walked through it". A user
 * who dismisses everything still shouldn't loop back to this screen every
 * time they open the app.
 */
export default function WelcomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const { data: workspacesData, isLoading: workspacesLoading } = useWorkspaces();

  // Redirect if the user is already onboarded — welcome should only be a
  // first-run experience. This runs after data loads so we never bounce a
  // user off their own onboarding by acting on a stale cache.
  useEffect(() => {
    if (!userLoading && user?.onboardedAt) {
      router.replace('/dashboard');
    }
  }, [user, userLoading, router]);

  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceCreated, setWorkspaceCreated] = useState<{ id: string; name: string } | null>(
    null
  );
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  // Prefill the display-name input from whatever the user already has, so
  // step 2 isn't an empty rectangle for people who signed up with a name.
  useEffect(() => {
    if (user?.name && !displayName) setDisplayName(user.name);
  }, [user, displayName]);

  const workspaces = workspacesData ?? [];

  const finish = async (opts?: { skipRedirect?: boolean; toConversations?: boolean }) => {
    try {
      await markOnboarded();
      await queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
    } catch {
      // Marking as onboarded is best-effort — a network hiccup here must
      // not trap the user on this screen, so we still route them onward.
    }
    if (opts?.skipRedirect) return;
    router.replace(opts?.toConversations ? '/conversations' : '/dashboard');
  };

  const handleCreateWorkspace = async () => {
    const name = workspaceName.trim();
    if (!name) {
      toast.error('Give your workspace a name');
      return;
    }
    setBusy(true);
    try {
      const ws = await createWorkspace({ name });
      setWorkspaceCreated({ id: ws.id, name: ws.name });
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setStep(1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not create workspace';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProfile = async () => {
    const name = displayName.trim();
    if (!name) {
      // Optional — an empty name just skips forward.
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      await updateProfile({ name });
      await queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
      setStep(2);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not save your profile';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  if (userLoading || workspacesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }

  // Someone who already has a workspace shouldn't be forced to create a
  // second one — jump straight to step 2 on mount for them.
  const skipWorkspaceStep = workspaces.length > 0 && step === 0;
  if (skipWorkspaceStep) {
    setStep(1);
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6 py-16">
        <header>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs">
            <Sparkles className="h-3 w-3" /> Welcome to Synora
          </div>
          <h1 className="text-3xl font-semibold text-foreground">
            Let&apos;s get you set up in about a minute.
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You can skip any step — this is a fast tour, not a form.
          </p>
        </header>

        <StepStrip step={step} />

        {step === 0 ? (
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Building2 className="h-4 w-4" /> Create your first workspace
              </div>
              <p className="text-sm text-muted-foreground">
                Workspaces keep your projects, conversations, and teammates together.
                Everything you do lives inside one — you can create more later.
              </p>
              <input
                autoFocus
                aria-label="Workspace name"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder={user?.name ? `${user.name}'s workspace` : 'My workspace'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateWorkspace();
                }}
                disabled={busy}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => finish()}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Skip for now
                </button>
                <Button onClick={handleCreateWorkspace} loading={busy}>
                  Create workspace <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : step === 1 ? (
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <UserIcon className="h-4 w-4" /> How should we address you?
              </div>
              <p className="text-sm text-muted-foreground">
                This shows up in shared conversations and audit logs. You can change it any
                time in Settings.
              </p>
              <input
                aria-label="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveProfile();
                }}
                disabled={busy}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Skip
                </button>
                <Button onClick={handleSaveProfile} loading={busy}>
                  Continue <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <MessagesSquare className="h-4 w-4" /> You&apos;re all set{workspaceCreated ? `, ${workspaceCreated.name}` : ''}.
              </div>
              <p className="text-sm text-muted-foreground">
                Start with a conversation, or explore the dashboard first — either way, we&apos;re
                good.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/conversations"
                  onClick={() => finish({ skipRedirect: true })}
                  className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/60"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <MessagesSquare className="h-4 w-4" /> Start your first conversation
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pick a model, ask anything, watch it stream back.
                  </p>
                  <div className="mt-2 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Go to conversations →
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => finish()}
                  className="group rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/60"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles className="h-4 w-4" /> Explore the dashboard
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Poke around first. You can start a conversation any time.
                  </p>
                </button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StepStrip({ step }: { step: number }) {
  const labels = ['Workspace', 'Profile', 'Start'];
  return (
    <ol className="flex items-center gap-2" aria-label="Onboarding progress">
      {labels.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                done
                  ? 'border-primary bg-primary text-primary-foreground'
                  : active
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground'
              }`}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span className={`text-xs ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
              {label}
            </span>
            {i < labels.length - 1 ? (
              <div className={`ml-1 h-px flex-1 ${done ? 'bg-primary/60' : 'bg-border'}`} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
