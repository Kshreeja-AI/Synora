'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';
import { useCreateAgent, type ApprovalPolicy, type MemoryAccess } from '@/lib/api/agents';

/**
 * Creating an agent is creating something that will act on the user's
 * behalf, so the form leads with the two questions that decide how much it
 * can do — which tools, and when it must stop and ask — rather than burying
 * them under a name field.
 *
 * The defaults shown match the server's fail-closed defaults exactly (no
 * tools, pause on anything that mutates). A form that displayed friendlier
 * defaults than the server enforces would teach the wrong mental model.
 */
export function CreateAgentDialog({
  workspaceId,
  open,
  onClose,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [allowedTools, setAllowedTools] = useState('');
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>('mutations');
  const [memoryAccess, setMemoryAccess] = useState<MemoryAccess>('none');
  const create = useCreateAgent(workspaceId);

  if (!open) return null;

  function reset() {
    setName('');
    setDescription('');
    setInstructions('');
    setAllowedTools('');
    setApprovalPolicy('mutations');
    setMemoryAccess('none');
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        instructions: instructions.trim(),
        allowedTools: allowedTools
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        approvalPolicy,
        memoryAccess,
      },
      {
        onSuccess: () => {
          toast.success('Agent created');
          reset();
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
      aria-label="Create agent"
    >
      <form
        onSubmit={submit}
        className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto rounded-lg bg-background p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold">New agent</h2>

        <div className="space-y-1">
          <label htmlFor="agent-name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="agent-description" className="text-sm font-medium">
            Description <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="agent-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="agent-instructions" className="text-sm font-medium">
            Instructions
          </label>
          <textarea
            id="agent-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            required
            rows={4}
            className="w-full rounded-md border border-input bg-background p-3 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            What this agent is for and how it should behave. An agent with no stated behaviour
            is refused — an undefined executor is not something to create quietly.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="agent-tools" className="text-sm font-medium">
            Allowed tools
          </label>
          <input
            id="agent-tools"
            value={allowedTools}
            onChange={(e) => setAllowedTools(e.target.value)}
            placeholder="comma-separated tool ids — leave empty for none"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Empty means no tools at all, not all tools. A plan that names a tool outside this
            list is refused whole, before anything runs.
          </p>
        </div>

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">When should it stop and ask you?</legend>
          <select
            value={approvalPolicy}
            onChange={(e) => setApprovalPolicy(e.target.value as ApprovalPolicy)}
            aria-label="Approval policy"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="mutations">
              Before anything that changes something (recommended)
            </option>
            <option value="everything">Before every tool it uses</option>
            <option value="nothing">Never — run to completion on its own</option>
          </select>
          <p className="text-xs text-muted-foreground">
            A step that does not declare itself read-only is treated as if it changes
            something, so &quot;never asks&quot; is always a deliberate choice.
          </p>
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Workspace memory</legend>
          <select
            value={memoryAccess}
            onChange={(e) => setMemoryAccess(e.target.value as MemoryAccess)}
            aria-label="Memory access"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="none">No access (recommended)</option>
            <option value="recall">Read past notes and results</option>
            <option value="record">Write down what it did</option>
            <option value="both">Read and write</option>
          </select>
          {/* Stated because "memory" sounds harmless and is not: it is
              whatever your workspace has written down. */}
          <p className="text-xs text-muted-foreground">
            Reading lets this agent see your workspace&apos;s saved notes and past results — but
            only the ones you could already see yourself. Writing adds a record of each
            successful run, labelled with what produced it.
          </p>
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create agent
          </Button>
        </div>
      </form>
    </div>
  );
}
