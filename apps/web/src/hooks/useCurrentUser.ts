'use client';

import { useEffect } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getCurrentUser } from '../lib/api/account';
import type { CurrentUser } from '../lib/api/types';
import { useAuthStore } from '../stores/auth-store';

/**
 * The signed-in user, backed by `GET /api/users/me` via TanStack Query and
 * mirrored into the Zustand auth store (so components that only need
 * `{ id, email, name, emailVerified }` — e.g. a topbar — don't each pay for
 * their own network request).
 *
 * Tokens are in HttpOnly cookies and automatically sent by the browser.
 * The query will run and either succeed (if cookies are valid) or fail (if
 * not authenticated).
 */
export function useCurrentUser(): UseQueryResult<CurrentUser> {
  const setSession = useAuthStore((state) => state.setSession);
  const clearSession = useAuthStore((state) => state.clearSession);

  const query = useQuery({
    queryKey: ['users', 'me'],
    queryFn: getCurrentUser,
    retry: false,
  });

  useEffect(() => {
    if (query.data) {
      setSession({
        id: query.data.id,
        email: query.data.email,
        name: query.data.name,
        emailVerified: query.data.emailVerified,
      });
    }
  }, [query.data, setSession]);

  useEffect(() => {
    if (query.isError) {
      clearSession();
    }
  }, [query.isError, clearSession]);

  return query;
}
