'use client';

import { useState } from 'react';
import { useCreateBranch } from '@/lib/api/branches';
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
import { GitBranch } from 'lucide-react';

interface CreateBranchButtonProps {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  onBranchCreated?: (branchId: string) => void;
}

export function CreateBranchButton({
  workspaceId,
  conversationId,
  messageId,
  onBranchCreated,
}: CreateBranchButtonProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const { mutate: createBranch, isPending } = useCreateBranch(
    workspaceId,
    conversationId,
    messageId
  );

  const handleCreate = () => {
    createBranch(
      { title: title.trim() || undefined },
      {
        onSuccess: (branch) => {
          setTitle('');
          setOpen(false);
          onBranchCreated?.(branch.id);
        },
      }
    );
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition"
        title="Create alternative response"
      >
        <GitBranch className="h-3.5 w-3.5" />
        Branch
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Alternative Response</DialogTitle>
            <DialogDescription>
              Generate an alternative response from this point in the conversation
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Branch Name (optional)</label>
              <Input
                placeholder="e.g., More creative"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isPending}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={isPending}>
                {isPending ? (
                  <>
                    <Spinner size="sm" />
                    Creating...
                  </>
                ) : (
                  'Create Branch'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
