'use client';

import { useState } from 'react';
import { useConversationBranches, useActivateBranch, useDeleteBranch } from '@/lib/api/branches';
import { GitBranch, Trash2, Check } from 'lucide-react';

interface BranchSelectorProps {
  workspaceId: string;
  conversationId: string;
  onBranchChange?: (branchId: string) => void;
}

export function BranchSelector({
  workspaceId,
  conversationId,
  onBranchChange,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const { data: branches } = useConversationBranches(
    workspaceId,
    conversationId
  );
  const { mutate: activateBranch, isPending: isActivating } = useActivateBranch(
    workspaceId,
    conversationId
  );
  const { mutate: deleteBranch, isPending: isDeleting } = useDeleteBranch(
    workspaceId,
    conversationId
  );

  if (!branches || branches.length === 0) {
    return null;
  }

  const activeBranch = branches.find(b => b.isActive);
  const isLoading_ = isActivating || isDeleting;

  const handleActivate = (branchId: string) => {
    activateBranch(branchId, {
      onSuccess: () => {
        onBranchChange?.(branchId);
        setOpen(false);
      },
    });
  };

  const handleDelete = (e: React.MouseEvent, branchId: string) => {
    e.stopPropagation();
    if (confirm('Delete this branch and all its messages?')) {
      deleteBranch(branchId);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        disabled={isLoading_}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 transition"
      >
        <GitBranch className="h-4 w-4" />
        {activeBranch?.title || 'Main'}
        <span className="text-xs text-muted-foreground">({branches.length})</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-10 mt-2 w-64 rounded-lg border border-border bg-popover shadow-lg">
          <div className="max-h-96 overflow-y-auto space-y-1 p-2">
            {branches.map((branch) => (
              <button
                key={branch.id}
                onClick={() => handleActivate(branch.id)}
                disabled={isLoading_}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm text-left hover:bg-accent disabled:opacity-50 transition"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {branch.isActive && <Check className="h-4 w-4 text-green-600" />}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{branch.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {branch.messageCount} message{branch.messageCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(e, branch.id)}
                  disabled={isLoading_ || branch.isActive}
                  className="p-1 hover:bg-destructive/10 rounded disabled:opacity-50 transition"
                  title="Delete branch"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </button>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
