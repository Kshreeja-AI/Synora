import { Suspense } from 'react';
import { Card, CardContent, Spinner } from '@synora/design-system';
import { VerifyEmailForm } from './VerifyEmailForm';

function VerifyEmailFallback(): React.JSX.Element {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <Spinner size="lg" />
        <p className="text-muted-foreground">Verifying your email...</p>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage(): React.JSX.Element {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailForm />
    </Suspense>
  );
}
