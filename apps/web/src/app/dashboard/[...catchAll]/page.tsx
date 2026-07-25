import { notFound } from 'next/navigation';

/**
 * Any URL under /dashboard that doesn't match a real page lands here and is
 * immediately handed to notFound() — this is what makes the nearest
 * `not-found.tsx` (dashboard/not-found.tsx, which keeps the sidebar/topbar
 * chrome) reachable for arbitrary unmatched paths, not just from an
 * explicit `notFound()` call inside a real page.
 */
export default function DashboardCatchAll(): never {
  notFound();
}
