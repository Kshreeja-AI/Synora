import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button, EmptyState } from '@synora/design-system';

export default function DashboardNotFound(): React.JSX.Element {
  return (
    <EmptyState
      icon={<FileQuestion />}
      title="Page not found"
      description="This page doesn't exist. It may have been moved, or the link is out of date."
      action={
        <Button asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
      className="mx-auto max-w-md border-none py-24"
    />
  );
}
