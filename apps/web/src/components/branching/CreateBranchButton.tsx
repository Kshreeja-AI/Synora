/**
 * "Branch here" affordance for an assistant message.
 *
 * Creates a new empty sibling under the same parent as the message
 * being branched from. The backend then treats the new sibling as an
 * ordinary assistant message; a generation job can be enqueued
 * separately by the caller if the intent is "give me an alternative".
 * We deliberately keep the button dumb — it only forks; the caller
 * decides whether to also regenerate.
 */

'use client';

import { useCreateBranch } from '@/lib/api/branches';
import { GitBranch } from 'lucide-react';

interface CreateBranchButtonProps {
  workspaceId: string;
  conversationId: string;
  /**
   * The parent under which to create a new sibling. For "give me
   * another version of *this* assistant answer", pass the assistant
   * message's own `parentId` (the user turn).
   */
  parentId: string;
  /** Fired with the new sibling's id after creation succeeds. */
  onBranchCreated?: (newMessageId: string) => void;
  disabled?: boolean;
}

export function CreateBranchButton({
  workspaceId,
  conversationId,
  parentId,
  onBranchCreated,
  disabled,
}: CreateBranchButtonProps) {
  const { mutate: createBranch, isPending } = useCreateBranch(
    workspaceId,
    conversationId
  );

  const handleClick = () => {
    createBranch(
      { parentId, content: '' },
      {
        onSuccess: (message) => {
          onBranchCreated?.(message.id);
        },
      }
    );
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isPending}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Branch this response"
      title="Create an alternative response from this point"
    >
      <GitBranch className="h-3 w-3" />
      Branch
    </button>
  );
}
