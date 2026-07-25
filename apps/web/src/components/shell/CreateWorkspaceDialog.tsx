'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Label,
  toast,
} from '@synora/design-system';
import { createWorkspace } from '../../lib/api/workspaces';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useCreateWorkspaceStore } from '../../stores/create-workspace-store';
import { ApiError } from '../../lib/api/client';

export function CreateWorkspaceDialog(): React.JSX.Element {
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const setCurrentWorkspaceId = useWorkspaceStore((state) => state.setCurrentWorkspaceId);
  const isOpen = useCreateWorkspaceStore((state) => state.isOpen);
  const closeDialog = useCreateWorkspaceStore((state) => state.close);

  const mutation = useMutation({
    mutationFn: () => createWorkspace({ name: name.trim() }),
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      // Creating a workspace also creates a "Workspace created" notification server-side.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setCurrentWorkspaceId(workspace.id);
      toast.success(`"${workspace.name}" is ready.`);
      setName('');
      closeDialog();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to create workspace.');
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>Give your workspace a name. You can change this later.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length > 0) mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Inc"
              autoFocus
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={name.trim().length === 0}>
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
