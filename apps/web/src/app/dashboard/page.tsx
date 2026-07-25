'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, Skeleton } from '@synora/design-system';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { resendVerificationEmail } from '../../lib/api/auth';

const createActions = [
  {
    icon: '🎨',
    title: 'Image Generation',
    description: 'Generate stunning images from text descriptions.',
    href: '/dashboard/create?type=image',
    cta: 'Create Image',
  },
  {
    icon: '🎬',
    title: 'Video Generation',
    description: 'Generate videos from prompts and scripts.',
    href: '/dashboard/create?type=video',
    cta: 'Create Video',
  },
  {
    icon: '✍️',
    title: 'Document Writing',
    description: 'Write and edit documents with AI assistance.',
    href: '/dashboard/create?type=document',
    cta: 'Write Document',
  },
  {
    icon: '💻',
    title: 'Code Generation',
    description: 'Generate and optimize code with AI.',
    href: '/dashboard/create?type=code',
    cta: 'Generate Code',
  },
];

export default function DashboardPage(): React.JSX.Element {
  const { data: user, isLoading } = useCurrentUser();
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  const handleResend = async (): Promise<void> => {
    setResendStatus('sending');
    try {
      await resendVerificationEmail();
      setResendStatus('sent');
    } catch {
      setResendStatus('idle');
    }
  };

  if (isLoading || !user) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-5 w-72" />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
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
      <p className="mb-8 text-muted-foreground">Start creating amazing content with Synora AI.</p>

      <div className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-2">
        {createActions.map((action) => (
          <Card key={action.title}>
            <CardContent className="p-6">
              <h2 className="mb-4 text-2xl font-bold text-foreground">
                {action.icon} {action.title}
              </h2>
              <p className="mb-4 text-muted-foreground">{action.description}</p>
              <Button asChild variant="primary">
                <Link href={action.href}>{action.cta}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 text-2xl font-bold text-foreground">Recent Projects</h2>
          <p className="text-muted-foreground">
            No projects yet. Create your first project to get started!
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
