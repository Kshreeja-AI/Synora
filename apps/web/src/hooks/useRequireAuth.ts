'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCurrentUser } from './useCurrentUser';
import { getAccessToken } from '../lib/auth/token-storage';

/**
 * Client-side guard for authenticated routes: redirects to
 * `/auth/login?next=<current path>` when there's no access token, or when
 * the current one turns out to be invalid (the `users/me` fetch errors even
 * after the API client's automatic refresh-retry). Login/register read
 * `next` back off the URL to return the user to where they were headed.
 */
export function useRequireAuth(): ReturnType<typeof useCurrentUser> {
  const router = useRouter();
  const pathname = usePathname();
  const query = useCurrentUser();

  useEffect(() => {
    if (!getAccessToken() || query.isError) {
      const next = pathname ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/auth/login${next}`);
    }
  }, [query.isError, pathname, router]);

  return query;
}
