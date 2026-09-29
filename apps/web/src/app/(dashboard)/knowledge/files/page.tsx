'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { Button, EmptyState, Spinner } from '@synora/design-system';
import { toast } from 'sonner';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { deleteAsset, listAssets, uploadAsset } from '@/lib/api/assets';
import type { Asset } from '@/lib/api/types';

/**
 * Workspace files.
 *
 * WHY THIS PAGE EXISTS, and why it is not a new subsystem. Workspace
 * assets have been storable and listable over the API since M5, and the
 * only surface that ever showed them was the project detail page. So a
 * file not attached to a project was reachable by the server and
 * unreachable by a person — the same "built but you cannot get to it"
 * problem as the agent engine, at a much smaller scale.
 *
 * This is a navigation fix, not a capability. Nothing new is stored and no
 * new endpoint exists; the page lists what was already there. Saying that
 * plainly matters, because a files page that looked like a new document
 * system would overstate what changed.
 */

const KEY = 'workspace-assets';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function WorkspaceFilesPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const {
    data: assets = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [KEY, workspaceId],
    queryFn: () => listAssets(workspaceId),
    enabled: !!workspaceId,
  });

  const remove = useMutation({
    mutationFn: (assetId: string) => deleteAsset(workspaceId, assetId),
    onSuccess: () => {
      toast.success('File deleted');
      queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadAsset(workspaceId, file);
      toast.success(`${file.name} uploaded`);
      queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
    } catch (err) {
      // The server enforces the real size and type limits; surfacing its
      // message names which one was hit.
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  if (!workspaceId) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Files</h1>
          <p className="text-sm text-muted-foreground">
            Everything stored in this workspace, including files attached to a project.
          </p>
        </div>
        <div>
          <input
            ref={fileInput}
            type="file"
            onChange={onPick}
            aria-label="Upload a file"
            className="hidden"
          />
          <Button onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Upload
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : assets.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No files yet"
          description="Upload reference material here. Files attached to a project appear in this list too."
        />
      ) : (
        <ul className="space-y-2">
          {assets.map((asset: Asset) => (
            <li
              key={asset.id}
              className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1 truncate font-medium">{asset.name}</span>
              <span className="text-xs text-muted-foreground">{asset.mimeType}</span>
              <span className="text-xs text-muted-foreground">{formatSize(asset.size)}</span>
              {asset.projectId && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  in a project
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                aria-label={`Delete ${asset.name}`}
                onClick={() => remove.mutate(asset.id)}
                disabled={remove.isPending}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
