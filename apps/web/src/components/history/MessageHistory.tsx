'use client';

import { useState } from 'react';
import { useMessageVersions, useRestoreMessageVersion } from '@/lib/api/messageHistory';

import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface MessageHistoryProps {
  workspaceId: string;
  conversationId: string;
  messageId: string;
}

export function MessageHistory({
  workspaceId,
  conversationId,
  messageId,
}: MessageHistoryProps) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const { data: versions, isLoading } = useMessageVersions(workspaceId, conversationId, messageId);
  const { mutate: restoreVersion, isPending: isRestoring } = useRestoreMessageVersion(
    workspaceId,
    conversationId,
    messageId
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner size="sm" />
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-4">
        No version history available
      </div>
    );
  }

  const selectedVersion = versions.find((v) => v.id === selectedVersionId);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="text-xs font-medium">Available Versions</label>
        <div className="max-h-32 overflow-y-auto space-y-1 rounded border border-border bg-muted/30 p-2">
          {versions.map((version) => (
            <button
              key={version.id}
              onClick={() => setSelectedVersionId(version.id)}
              className={`w-full text-left text-xs p-2 rounded transition ${
                selectedVersionId === version.id
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                  : 'hover:bg-muted'
              }`}
            >
              <div className="flex justify-between">
                <span className="font-medium">v{version.version}</span>
                <span className="text-muted-foreground">
                  {new Date(version.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="text-xs text-muted-foreground line-clamp-1">
                {version.content}
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedVersion && selectedVersion.id !== versions[0].id && (
        <div className="space-y-2 rounded bg-muted/50 p-3">
          <p className="text-xs font-medium">Preview:</p>
          <div className="text-xs max-h-24 overflow-y-auto whitespace-pre-wrap rounded bg-background p-2 border border-border">
            {selectedVersion.content}
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (selectedVersion.id) {
                restoreVersion(selectedVersion.id);
                setSelectedVersionId(null);
              }
            }}
            disabled={isRestoring}
            className="w-full gap-2"
          >
            {isRestoring ? (
              <>
                <Spinner size="sm" />
                Restoring...
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4" />
                Restore This Version
              </>
            )}
          </Button>
        </div>
      )}

      {selectedVersionId && versions[0].id === selectedVersionId && (
        <div className="rounded bg-green-50 dark:bg-green-950 p-3 text-xs text-green-900 dark:text-green-100 flex gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <p>This is the current version</p>
        </div>
      )}
    </div>
  );
}
