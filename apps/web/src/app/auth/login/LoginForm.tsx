'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, Checkbox, Input, Label } from '@synora/design-system';
import { PasswordInput } from '../../../components/auth/PasswordInput';
import { login } from '../../../lib/api/auth';
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

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password, rememberMe);
      router.push(safeNextPath(searchParams.get('next')));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
