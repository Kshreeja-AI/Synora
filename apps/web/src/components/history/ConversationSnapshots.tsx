'use client';

import { useState } from 'react';
import {
  useConversationSnapshots,
  useCreateSnapshot,
} from '@/lib/api/messageHistory';

import { Button } from '@synora/design-system/components/Button';
import { Input } from '@synora/design-system/components/Input';
import { Spinner } from '@synora/design-system/components/Spinner';
import { Trash2, Save } from 'lucide-react';

interface ConversationSnapshotsProps {
  workspaceId: string;
  conversationId: string;
}

export function ConversationSnapshots({
  workspaceId,
  conversationId,
}: ConversationSnapshotsProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const { data: snapshots, isLoading } = useConversationSnapshots(
    workspaceId,
    conversationId
  );
  const { mutate: createSnapshot, isPending: isCreating } = useCreateSnapshot(
    workspaceId,
    conversationId
  );

  const handleCreate = () => {
    if (!title.trim()) return;

    createSnapshot(
      {
        title: title.trim(),
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setTitle('');
          setDescription('');
          setShowCreateForm(false);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner size="sm" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!showCreateForm ? (
        <Button
          type="button"
          size="sm"
          onClick={() => setShowCreateForm(true)}
          className="w-full gap-2"
        >
          <Save className="h-4 w-4" />
          Create Snapshot
        </Button>
      ) : (
        <div className="space-y-2 rounded border border-border bg-muted/30 p-3">
          <Input
            type="text"
            placeholder="Snapshot title (e.g., 'Final version')"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            className="text-sm"
            disabled={isCreating}
          />
          <Input
            type="text"
            placeholder="Optional description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            className="text-sm"
            disabled={isCreating}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              disabled={!title.trim() || isCreating}
              className="flex-1 gap-2"
            >
              {isCreating ? (
                <>
                  <Spinner size="sm" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Create
                </>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowCreateForm(false)}
              disabled={isCreating}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {snapshots && snapshots.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Snapshots ({snapshots.length})
          </p>
          <div className="max-h-48 overflow-y-auto space-y-1 rounded border border-border bg-muted/30 p-2">
            {snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="flex items-start justify-between p-2 rounded hover:bg-muted/50 transition"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{snapshot.title}</p>
                  {snapshot.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {snapshot.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {snapshot.messageCount} messages •{' '}
                    {new Date(snapshot.createdAt).toLocaleString()}
                  </p>
                </div>
                <button className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-destructive transition">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(!snapshots || snapshots.length === 0) && !showCreateForm && (
        <div className="text-xs text-muted-foreground text-center py-3">
          No snapshots yet. Create one to save the current state.
        </div>
      )}
    </div>
  );
}
