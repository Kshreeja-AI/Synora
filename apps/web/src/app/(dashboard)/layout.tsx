'use client';

import { AppShell } from '@/components/shell/AppShell';

/**
 * The `(dashboard)` route group holds the full-bleed authenticated
 * surfaces — chat (`/conversations`) and the knowledge library
 * (`/knowledge/*`) — which live at the URL root rather than under
 * `/dashboard`. Until this layout existed the group had none, so those
 * pages rendered with no auth guard and no application frame.
 *
 * Content padding is off here because every page in the group supplies
 * its own chrome (the conversation rail, the knowledge tab bar).
 */
export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return <AppShell contentClassName="">{children}</AppShell>;
}
