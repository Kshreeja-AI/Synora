import { Suspense } from 'react';
import { Card, CardContent, Skeleton } from '@synora/design-system';
import { ResetPasswordForm } from './ResetPasswordForm';

function ResetPasswordFallback(): React.JSX.Element {
  return (
    <Card>
      <CardContent className="space-y-4 p-8">
        <Skeleton className="mx-auto h-8 w-48" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage(): React.JSX.Element {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
