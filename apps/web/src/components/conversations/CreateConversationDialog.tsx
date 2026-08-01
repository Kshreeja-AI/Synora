'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateConversation } from '@/lib/api/conversations';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@synora/design-system/components/Dialog';
import { Button } from '@synora/design-system/components/Button';
import { Input } from '@synora/design-system/components/Input';
import { Spinner } from '@synora/design-system/components/Spinner';

interface CreateConversationDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateConversationDialog({
  workspaceId,
  open,
  onOpenChange,
}: CreateConversationDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const { mutate: createConversation, isPending } =
    useCreateConversation(workspaceId);

  const handleCreate = () => {
    if (!title.trim()) return;

    createConversation(
      {
        title: title.trim(),
        description: description.trim() || undefined,
      },
      {
        onSuccess: (conversation) => {
          setTitle('');
          setDescription('');
          onOpenChange(false);
          router.push(`/conversations/${conversation.id}`);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Conversation</DialogTitle>
          <DialogDescription>
            Start a new conversation to chat with AI
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Title</label>
            <Input
              placeholder="e.g., Marketing Strategy"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Description (optional)</label>
            <textarea
              placeholder="Add details about this conversation..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none h-20"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isPending || !title.trim()}
            >
              {isPending ? (
                <>
                  <Spinner size="sm" />
                  Creating...
                </>
              ) : (
                'Create'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
