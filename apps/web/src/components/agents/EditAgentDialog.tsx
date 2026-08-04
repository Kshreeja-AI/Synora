'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';
import {
  useUpdateAgent,
  type Agent,
  type ApprovalPolicy,
  type MemoryAccess,
} from '@/lib/api/agents';

/**
 * Editing an agent.
 *
 * THE THING THIS SCREEN MUST NOT HIDE. Saving does not change the agent —
 * it creates the next version, with a new identity, and leaves the previous
 * one intact because every past run references the exact version it
 * executed under. A user who believes they edited a thing in place will be
 * confused later by a run history pointing at "old" configurations, so the
 * form says what actually happens before they press the button rather than
 * after.
 */
export function EditAgentDialog({
  workspaceId,
  agent,
  open,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  agent: Agent;
  open: boolean;
  onClose: () => void;
  onSaved: (next: Agent) => void;
}) {
  const [name, setName] = useState(agent.name);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [allowedTools, setAllowedTools] = useState(agent.allowedTools.join(', '));
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(agent.approvalPolicy);
  const [memoryAccess, setMemoryAccess] = useState<MemoryAccess>(agent.memoryAccess ?? 'none');
  const update = useUpdateAgent(workspaceId);

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate(
      {
        agentId: agent.id,
        changes: {
          name: name.trim(),
          instructions: instructions.trim(),
          allowedTools: allowedTools
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          approvalPolicy,
          memoryAccess,
        },
      },
      {
        onSuccess: (next) => {
          toast.success(`Saved as version ${next.version}`);
          // The caller must switch to the NEW id: the one it held is now a
          // previous version, still resolvable but no longer current.
          onSaved(next);
          onClose();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit agent"
    >
      <form
        onSubmit={submit}
        className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto rounded-lg bg-background p-6 shadow-lg"
      >
        <div>
          <h2 className="text-lg font-semibold">Edit agent</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saving creates version {agent.version + 1}. Version {agent.version} is kept, because
            every past run refers to the exact version it ran under.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="edit-agent-name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="edit-agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="edit-agent-instructions" className="text-sm font-medium">
            Instructions
          </label>
          <textarea
            id="edit-agent-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            required
            rows={4}
            className="w-full rounded-md border border-input bg-background p-3 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="edit-agent-tools" className="text-sm font-medium">
            Allowed tools
          </label>
          <input
            id="edit-agent-tools"
            value={allowedTools}
            onChange={(e) => setAllowedTools(e.target.value)}
            placeholder="comma-separated tool ids — leave empty for none"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">When should it stop and ask you?</legend>
          <select
            value={approvalPolicy}
            onChange={(e) => setApprovalPolicy(e.target.value as ApprovalPolicy)}
            aria-label="Approval policy"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="mutations">Before anything that changes something</option>
            <option value="everything">Before every tool it uses</option>
            <option value="nothing">Never — run to completion on its own</option>
          </select>
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Workspace memory</legend>
          <select
            value={memoryAccess}
            onChange={(e) => setMemoryAccess(e.target.value as MemoryAccess)}
            aria-label="Memory access"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="none">No access</option>
            <option value="recall">Read past notes and results</option>
            <option value="record">Write down what it did</option>
            <option value="both">Read and write</option>
          </select>
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save as version {agent.version + 1}
          </Button>
        </div>
      </form>
    </div>
  );
}
