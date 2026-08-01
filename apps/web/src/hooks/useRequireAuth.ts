'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCurrentUser } from './useCurrentUser';

/**
 * Client-side guard for authenticated routes: redirects to
 * `/auth/login?next=<current path>` when the current user fetch fails
 * (indicating no valid auth token in HttpOnly cookies).
 * Login/register read `next` back off the URL to return the user to where
 * they were headed.
 */
export function useRequireAuth(): ReturnType<typeof useCurrentUser> {
  const router = useRouter();
  const pathname = usePathname();
  const query = useCurrentUser();

  useEffect(() => {
    if (query.isError) {
      const next = pathname ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/auth/login${next}`);
    }
  }, [query.isError, pathname, router]);

  return query;
}
