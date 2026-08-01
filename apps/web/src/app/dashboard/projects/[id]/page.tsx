'use client';

import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  cn,
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
import { ArrowLeft, File, Folder as FolderIcon, Plus, Trash2, Upload } from 'lucide-react';
import { useCurrentWorkspace } from '../../../../hooks/useCurrentWorkspace';
import { getProject, deleteProject } from '../../../../lib/api/projects';
import { listFolders, createFolder, deleteFolder, type ConversationFolder } from '../../../../lib/api/folders';
import { listAssets, uploadAsset, deleteAsset } from '../../../../lib/api/assets';
import { ApiError } from '../../../../lib/api/client';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CreateFolderDialog({
  workspaceId,
  projectId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createFolder(workspaceId, { name: name.trim(), projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders', workspaceId, projectId] });
      toast.success('Folder created.');
      setName('');
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to create folder.');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length > 0) mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input id="folder-name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          </div>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending} disabled={name.trim().length === 0}>
              Create folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentWorkspace } = useCurrentWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['projects', 'detail', projectId],
    queryFn: () => getProject(projectId),
  });

  const workspaceId = project?.workspaceId ?? undefined;

  const { data: folders } = useQuery({
    queryKey: ['folders', workspaceId, projectId],
    queryFn: () => listFolders(workspaceId!, { projectId }),
    enabled: Boolean(workspaceId),
  });

  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ['assets', workspaceId, projectId, selectedFolderId],
    queryFn: () => listAssets(workspaceId!, { projectId, folderId: selectedFolderId }),
    enabled: Boolean(workspaceId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadAsset(workspaceId!, file, { projectId, folderId: selectedFolderId ?? undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets', workspaceId, projectId] });
      toast.success('File uploaded.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to upload file.');
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: (assetId: string) => deleteAsset(workspaceId!, assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets', workspaceId, projectId] });
      toast.success('File deleted.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to delete file.');
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (folderId: string) => deleteFolder(workspaceId!, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders', workspaceId, projectId] });
      setSelectedFolderId((current) => (current ? null : current));
      toast.success('Folder deleted.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to delete folder.');
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: () => deleteProject(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      toast.success('Project deleted.');
      router.push('/dashboard/projects');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Failed to delete project.');
    },
  });

  const canManage =
    currentWorkspace?.role === 'OWNER' || currentWorkspace?.role === 'ADMIN' || currentWorkspace?.role === 'EDITOR';

  if (projectLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!project) {
    return (
      <EmptyState
        title="Project not found"
        description="This project may have been deleted or you no longer have access."
        action={<Button onClick={() => router.push('/dashboard/projects')}>Back to projects</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/projects')} className="mb-2 -ml-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Projects
          </Button>
          <h1 className="text-2xl font-semibold text-foreground">{project.name}</h1>
          {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}
        </div>
        {canManage && (
          <Button
            variant="outline"
            className="text-destructive"
            onClick={() => {
              if (window.confirm('Delete this project? This cannot be undone.')) {
                deleteProjectMutation.mutate();
              }
            }}
          >
            Delete project
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedFolderId(null)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                selectedFolderId === null
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent'
              )}
            >
              Unfiled
            </button>
            {folders?.map((folder: ConversationFolder) => (
              <span key={folder.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    selectedFolderId === folder.id
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                >
                  <FolderIcon className="h-3 w-3" aria-hidden />
                  {folder.name}
                </button>
                {canManage && (
                  <button
                    type="button"
                    aria-label={`Delete folder ${folder.name}`}
                    onClick={() => deleteFolderMutation.mutate(folder.id)}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground group-hover:flex"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {canManage && (
              <button
                type="button"
                onClick={() => setCreateFolderOpen(true)}
                className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
              >
                <Plus className="h-3 w-3" aria-hidden />
                New folder
              </button>
            )}
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Files</h2>
            {canManage && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadMutation.mutate(file);
                    event.target.value = '';
                  }}
                />
                <Button size="sm" loading={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </Button>
              </>
            )}
          </div>

          {assetsLoading || !assets ? (
            <Skeleton className="h-24 w-full" />
          ) : assets.length === 0 ? (
            <EmptyState icon={<File className="h-8 w-8" />} title="No files here" />
          ) : (
            <ul className="divide-y divide-border">
              {assets.map((asset) => (
                <li key={asset.id} className="flex items-center gap-3 py-3">
                  <File className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {asset.name}
                    </a>
                    <p className="text-xs text-muted-foreground">{formatBytes(asset.size)}</p>
                  </div>
                  <Badge variant="outline">{asset.mimeType}</Badge>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${asset.name}`}
                      onClick={() => deleteAssetMutation.mutate(asset.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {workspaceId && (
        <CreateFolderDialog
          workspaceId={workspaceId}
          projectId={projectId}
          open={createFolderOpen}
          onOpenChange={setCreateFolderOpen}
        />
      )}
    </div>
  );
}
