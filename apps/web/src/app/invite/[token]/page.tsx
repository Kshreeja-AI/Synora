'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, EmptyState, Skeleton, toast } from '@synora/design-system';
import { MailOpen } from 'lucide-react';
import { previewInvitation, acceptInvitation } from '../../../lib/api/invitations';
import { ApiError } from '../../../lib/api/client';
import { getAccessToken } from '../../../lib/auth/token-storage';
import { useWorkspaceStore } from '../../../stores/workspace-store';

export default function InvitePage(): React.JSX.Element {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const queryClient = useQueryClient();
  const setCurrentWorkspaceId = useWorkspaceStore((state) => state.setCurrentWorkspaceId);
  const [isAuthenticated] = useState(() => Boolean(getAccessToken()));

  const { data: preview, isLoading, isError } = useQuery({
    queryKey: ['invitations', token, 'preview'],
    queryFn: () => previewInvitation(token),
  });

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: ({ workspaceId }) => {
      setCurrentWorkspaceId(workspaceId);
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success('Invitation accepted.');
      router.push('/dashboard');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to accept invitation.');
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-6 p-8 text-center">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : isError || !preview ? (
            <EmptyState
              icon={<MailOpen className="h-8 w-8" />}
              title="Invitation not found"
              description="This invitation link is invalid, expired, or has already been used."
              action={<Button onClick={() => router.push('/')}>Go to homepage</Button>}
            />
          ) : (
            <>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Join {preview.workspaceName}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {preview.invitedBy || 'Someone'} invited <strong>{preview.email}</strong> to join as a{' '}
                  {preview.role.toLowerCase()}.
                </p>
              </div>
              {isAuthenticated ? (
                <Button className="w-full" loading={acceptMutation.isPending} onClick={() => acceptMutation.mutate()}>
                  Accept invitation
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Log in or create an account with <strong>{preview.email}</strong> to accept this invitation.
                  </p>
                  <div className="flex gap-2">
                    <Button className="flex-1" variant="outline" onClick={() => router.push('/auth/login')}>
                      Log in
                    </Button>
                    <Button className="flex-1" onClick={() => router.push('/auth/register')}>
                      Sign up
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
