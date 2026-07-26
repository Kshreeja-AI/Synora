import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button, EmptyState } from '@synora/design-system';

export default function NotFound(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <EmptyState
        icon={<FileQuestion />}
        title="Page not found"
        description="The page you're looking for doesn't exist or may have been moved."
        action={
          <Button asChild>
            <Link href="/">Go home</Link>
          </Button>
        }
        className="max-w-md border-none"
      />
    </div>
  );
}
