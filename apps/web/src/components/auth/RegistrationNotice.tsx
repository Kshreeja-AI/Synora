'use client';

import { useEffect, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { getRegistrationStatus, type RegistrationMode } from '../../lib/api/registration';

/**
 * Says up front when sign-up is by invitation, so nobody chooses a password
 * only to be refused. Renders nothing while the mode is unknown or when the
 * request fails — the form still works, and the API's own refusal message
 * remains the fallback.
 */
export function RegistrationNotice(): React.JSX.Element | null {
  const [mode, setMode] = useState<RegistrationMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRegistrationStatus()
      .then((status) => {
        if (!cancelled) setMode(status.mode);
      })
      .catch(() => {
        // Unknown is not an error worth showing.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode !== 'invite') return null;

  return (
    <div
      role="note"
      className="mb-6 flex gap-3 rounded-md border border-border bg-muted/40 p-3.5 text-sm text-muted-foreground"
    >
      <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <p>
        Synora is in private beta. Sign-up works for email addresses that have been invited to a
        workspace.
      </p>
    </div>
  );
}
