'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, Spinner } from '@synora/design-system';
import { verifyEmail, resendVerificationEmail } from '../../../lib/api/auth';
import { ApiError } from '../../../lib/api/client';

type Status = 'verifying' | 'success' | 'error';
type ResendStatus = 'idle' | 'sending' | 'sent' | 'error';

export function VerifyEmailForm(): React.JSX.Element {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>('verifying');
  const [message, setMessage] = useState('');
  const [resendStatus, setResendStatus] = useState<ResendStatus>('idle');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('This verification link is missing or malformed.');
      return;
    }

    let cancelled = false;
    verifyEmail(token)
      .then(() => {
        if (!cancelled) setStatus('success');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(err instanceof ApiError ? err.message : 'This verification link is invalid or has expired.');
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleResend = async (): Promise<void> => {
    setResendStatus('sending');
    try {
      await resendVerificationEmail();
      setResendStatus('sent');
    } catch {
      setResendStatus('error');
    }
  };

  if (status === 'verifying') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <Spinner size="lg" />
          <p className="text-muted-foreground">Verifying your email...</p>
        </CardContent>
      </Card>
    );
  }

  if (status === 'success') {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <h1 className="mb-4 text-2xl font-bold text-foreground">Email verified</h1>
          <p className="mb-6 text-muted-foreground">Your email address has been confirmed.</p>
          <Button asChild variant="primary" className="w-full">
            <Link href="/dashboard">Continue to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-8 text-center">
        <h1 className="mb-4 text-2xl font-bold text-foreground">Verification failed</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>

        {resendStatus === 'sent' ? (
          <p className="text-sm text-success">A new verification email has been sent.</p>
        ) : (
          <Button
            variant="outline"
            onClick={handleResend}
            loading={resendStatus === 'sending'}
            className="w-full"
          >
            Resend verification email
          </Button>
        )}
        {resendStatus === 'error' && (
          <p className="mt-3 text-sm text-muted-foreground">
            Sign in first, then resend the verification email from your account.
          </p>
        )}

        <p className="mt-6">
          <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
            Back to dashboard
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
