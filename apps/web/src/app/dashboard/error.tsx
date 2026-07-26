'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, EmptyState } from '@synora/design-system';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={<AlertTriangle />}
      title="Something went wrong"
      description="This page ran into a problem. Try again, or head back to the dashboard."
      action={<Button onClick={reset}>Try again</Button>}
      className="mx-auto max-w-md border-none py-24"
    />
  );
}
