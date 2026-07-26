'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, Label } from '@synora/design-system';
import { PasswordInput } from '../../../components/auth/PasswordInput';
import { resetPassword } from '../../../lib/api/auth';
import { ApiError } from '../../../lib/api/client';

export function ResetPasswordForm(): React.JSX.Element {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <h1 className="mb-4 text-2xl font-bold text-foreground">Invalid reset link</h1>
          <p className="text-muted-foreground">
            This password reset link is missing or malformed. Request a new one below.
          </p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link href="/auth/forgot-password">Request a new link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (success) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <h1 className="mb-4 text-2xl font-bold text-foreground">Password reset</h1>
          <p className="mb-6 text-muted-foreground">
            Your password has been changed. Sign in with your new password.
          </p>
          <Button asChild variant="primary" className="w-full">
            <Link href="/auth/login">Continue to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'This reset link is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-8">
        <h1 className="mb-8 text-center text-3xl font-bold text-foreground">Reset your password</h1>

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
            <Label htmlFor="password">New password</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
            {loading ? 'Resetting...' : 'Reset password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
