'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Skeleton,
  toast,
} from '@synora/design-system';
import { useCurrentWorkspace } from '../../../../hooks/useCurrentWorkspace';
import { updateWorkspace, listWorkspaceMembers } from '../../../../lib/api/workspaces';
import { ApiError } from '../../../../lib/api/client';

function WorkspaceDetailsSection(): React.JSX.Element {
  const { currentWorkspace, isLoading } = useCurrentWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  useEffect(() => {
    if (currentWorkspace) setName(currentWorkspace.name);
  }, [currentWorkspace]);

  const mutation = useMutation({
    mutationFn: () => updateWorkspace(currentWorkspace!.id, { name: name.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success('Workspace updated.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update workspace.');
    },
  });

  if (isLoading || !currentWorkspace) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const isOwner = currentWorkspace.role === 'OWNER';

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-foreground">Workspace details</h2>
        <div className="space-y-1.5">
          <Label htmlFor="workspace-slug">URL</Label>
          <p id="workspace-slug" className="text-sm text-muted-foreground">
            synora.ai/{currentWorkspace.slug}
          </p>
        </div>
        {isOwner ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim().length > 0) mutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={name.trim().length === 0 || name.trim() === currentWorkspace.name}
            >
              Save changes
            </Button>
          </form>
        ) : (
          <div className="space-y-1.5">
            <Label>Workspace name</Label>
            <p className="text-sm text-muted-foreground">
              {currentWorkspace.name} — only the workspace owner can rename this workspace.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MembersSection(): React.JSX.Element | null {
  const { currentWorkspace } = useCurrentWorkspace();

  const { data: members, isLoading } = useQuery({
    queryKey: ['workspaces', currentWorkspace?.id, 'members'],
    queryFn: () => listWorkspaceMembers(currentWorkspace!.id),
    enabled: Boolean(currentWorkspace?.id),
  });

  if (!currentWorkspace) return null;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-foreground">Members</h2>
        {isLoading || !members ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-3">
                <Avatar>
                  <AvatarImage src={member.user.image ?? undefined} alt="" />
                  <AvatarFallback>{(member.user.name || member.user.email).charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{member.user.name || 'Unnamed'}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                </div>
                <Badge variant="outline">{member.role}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkspaceSettingsPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <WorkspaceDetailsSection />
      <MembersSection />
    </div>
  );
}
