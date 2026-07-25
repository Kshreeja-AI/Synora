'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, EmptyState } from '@synora/design-system';

export default function RootError({
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
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <EmptyState
        icon={<AlertTriangle />}
        title="Something went wrong"
        description="An unexpected error occurred. Try again, or come back later."
        action={<Button onClick={reset}>Try again</Button>}
        className="max-w-md border-none"
      />
    </div>
  );
}
