'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  EmptyState,
  Input,
  Label,
  Skeleton,
  toast,
} from '@synora/design-system';
import { FolderKanban, Plus } from 'lucide-react';
import { useCurrentWorkspace } from '../../../hooks/useCurrentWorkspace';
import { listProjects, createProject } from '../../../lib/api/projects';
import { ApiError } from '../../../lib/api/client';

function CreateProjectDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createProject({ name: name.trim(), workspaceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      toast.success('Project created.');
      setName('');
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to create project.');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length > 0) mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Q3 campaign"
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending} disabled={name.trim().length === 0}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectsPage(): React.JSX.Element {
  const { currentWorkspace, isLoading: workspaceLoading } = useCurrentWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', currentWorkspace?.id],
    queryFn: () => listProjects(currentWorkspace!.id),
    enabled: Boolean(currentWorkspace?.id),
  });

  const canCreate =
    currentWorkspace?.role === 'OWNER' || currentWorkspace?.role === 'ADMIN' || currentWorkspace?.role === 'EDITOR';

  if (workspaceLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (!currentWorkspace) {
    return (
      <EmptyState
        icon={<FolderKanban className="h-8 w-8" />}
        title="No workspace yet"
        description="Create a workspace from the sidebar to start organizing projects."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground">Projects in {currentWorkspace.name}</p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New project
          </Button>
        )}
      </div>

      {isLoading || !projects ? (
        <Skeleton className="h-48 w-full" />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-8 w-8" />}
          title="No projects yet"
          description={canCreate ? 'Create your first project to start organizing folders and assets.' : undefined}
          action={canCreate ? <Button onClick={() => setCreateOpen(true)}>New project</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/dashboard/projects/${project.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="space-y-2 p-5">
                  <h2 className="truncate font-medium text-foreground">{project.name}</h2>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {project.description || 'No description'}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreateProjectDialog workspaceId={currentWorkspace.id} open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
