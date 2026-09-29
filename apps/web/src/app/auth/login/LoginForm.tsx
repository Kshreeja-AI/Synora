'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, Checkbox, Input, Label } from '@synora/design-system';
import { PasswordInput } from '../../../components/auth/PasswordInput';
import { login, isMfaChallenge } from '../../../lib/api/auth';
import {
  verifyMfaChallenge,
  verifyMfaChallengeWithRecoveryCode,
} from '../../../lib/api/mfa';
import { ApiError } from '../../../lib/api/client';

function safeNextPath(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Second-factor step. A non-null challenge token switches the form from
  // password entry to code entry; the token is single-use and expires after
  // five minutes, so a stale attempt sends the user back to step one.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const destination = safeNextPath(searchParams.get('next'));

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email, password, rememberMe);
      if (isMfaChallenge(result)) {
        setChallengeToken(result.mfaChallengeToken);
      } else {
        router.push(destination);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!challengeToken) return;
    setError('');
    setLoading(true);

    try {
      if (useRecoveryCode) {
        await verifyMfaChallengeWithRecoveryCode(challengeToken, code.trim());
      } else {
        await verifyMfaChallenge(challengeToken, code.trim());
      }
      router.push(destination);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const backToPassword = (): void => {
    setChallengeToken(null);
    setCode('');
    setUseRecoveryCode(false);
    setError('');
  };

  if (challengeToken) {
    return (
      <Card>
        <CardContent className="p-8">
          <h1 className="mb-2 text-center text-3xl font-bold text-foreground">
            Two-Factor Authentication
          </h1>
          <p className="mb-6 text-center text-sm text-muted-foreground">
            {useRecoveryCode
              ? 'Enter one of your recovery codes.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="mfa-code">
                {useRecoveryCode ? 'Recovery code' : 'Verification code'}
              </Label>
              <Input
                id="mfa-code"
                type="text"
                inputMode={useRecoveryCode ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                placeholder={useRecoveryCode ? 'XXXX-XXXX' : '123456'}
                maxLength={useRecoveryCode ? 16 : 6}
              />
            </div>

            <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
              {loading ? 'Verifying...' : 'Verify'}
            </Button>
          </form>

          <div className="mt-6 space-y-2 text-center text-sm">
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setUseRecoveryCode((v) => !v);
                setCode('');
                setError('');
              }}
            >
              {useRecoveryCode ? 'Use authenticator code instead' : 'Use a recovery code instead'}
            </button>
            <div>
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={backToPassword}
              >
                Back to sign in
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-8">
        <h1 className="mb-8 text-center text-3xl font-bold text-foreground">Sign In</h1>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/auth/forgot-password" className="text-xs font-medium text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="remember-me"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(checked === true)}
            />
            <Label htmlFor="remember-me" className="cursor-pointer font-normal">
              Remember me
            </Label>
          </div>

          <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>

        <p className="mt-6 text-center text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/auth/register" className="font-semibold text-primary hover:underline">
            Register
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
