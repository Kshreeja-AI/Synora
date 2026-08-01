'use client';

/**
 * Conversations page — Release 3 placeholder
 *
 * This page is reserved for the Release 3 conversational AI workspace.
 * Implementation scheduled for Release 3 (M1-M10).
 *
 * Temporary redirect to dashboard while Release 3 is under development.
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ConversationsPage() {
  const router = useRouter();

  useEffect(() => {
    router.push('/dashboard');
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-slate-600">Redirecting...</p>
    </div>
  );
}
