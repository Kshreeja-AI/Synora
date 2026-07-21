'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@synora/design-system';
import { useCsrfToken } from '@/hooks/useCsrfToken';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { token: csrfToken, isLoading: csrfLoading, refreshToken } = useCsrfToken();

  const handleSubmit = async (e: React.FormEvent) => {
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
      if (!csrfToken) {
        throw new Error('CSRF token not available');
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ email, password, name }),
      });

      const data = await response.json();

      // Handle CSRF token expiration
      if (response.status === 403 && data.error?.code === 'CSRF_TOKEN_EXPIRED') {
        const newToken = await refreshToken();
        if (!newToken) {
          setError('Security token expired. Please refresh and try again.');
          return;
        }
        // Retry with new token
        return handleSubmit(e);
      }

      if (!response.ok) {
        setError(data.error?.message || 'Registration failed');
        return;
      }

      localStorage.setItem('token', data.data.token);
      window.location.href = '/dashboard';
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-8">
      <h1 className="text-3xl font-bold text-center mb-8 text-gray-900">Create Account</h1>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-700">
          {error}
        </div>
      )}

      {csrfLoading && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded text-blue-700">
          Initializing security features...
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-md"
            placeholder="Your name"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-md"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-md"
            placeholder="••••••••"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-md"
            placeholder="••••••••"
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={loading || csrfLoading || !csrfToken}
          className="w-full"
        >
          {loading ? 'Creating account...' : 'Sign Up'}
        </Button>
      </form>

      <p className="text-center text-gray-600 mt-6">
        Already have an account?{' '}
        <Link href="/auth/login" className="text-blue-600 font-semibold hover:underline">
          Sign In
        </Link>
      </p>
    </div>
  );
}
