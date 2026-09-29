'use client';

import { useState } from 'react';
import { useCurrentWorkspace } from '../../../hooks/useCurrentWorkspace';
import {
  useWorkspaceTools,
  useDeleteTool,
  useToolExecutions,
  isActiveExecution,
  type Tool,
} from '@/lib/api/tools';
import { ToolExecutor } from '@/components/tools/ToolExecutor';
import { CreateToolDialog } from '@/components/tools/CreateToolDialog';
import { Button } from '@synora/design-system/components/Button';
import { EmptyState } from '@synora/design-system/components/EmptyState';
import { Spinner } from '@synora/design-system/components/Spinner';
import { Wrench, Plus, Trash2, ShieldCheck } from 'lucide-react';

function ExecutionHistory({ workspaceId, toolId }: { workspaceId: string; toolId: string }) {
  const { data: executions = [], isLoading } = useToolExecutions(workspaceId, toolId);

  if (isLoading) {
    return <Spinner size="sm" />;
  }
  if (executions.length === 0) {
    return <p className="text-xs text-muted-foreground">No executions yet.</p>;
  }

  return (
    <ul className="space-y-1">
      {executions.slice(0, 10).map((execution) => (
        <li
          key={execution.id}
          className="flex items-center justify-between rounded border border-border px-2 py-1.5 text-xs"
        >
          <span
            className={
              isActiveExecution(execution.status)
                ? 'font-medium text-yellow-700 dark:text-yellow-500'
                : execution.status === 'COMPLETED'
                  ? 'font-medium text-green-700 dark:text-green-500'
                  : 'font-medium text-red-700 dark:text-red-500'
            }
          >
            {execution.status}
          </span>
          <span className="text-muted-foreground">
            {new Date(execution.createdAt).toLocaleString()}
            {typeof execution.duration === 'number' && ` · ${execution.duration}ms`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ToolsPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const { data: tools = [], isLoading } = useWorkspaceTools(workspaceId);
  const { mutate: deleteTool } = useDeleteTool(workspaceId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selectedTool: Tool | undefined = tools.find((tool) => tool.id === selectedId);

  const handleDelete = (toolId: string) => {
    if (confirmDeleteId !== toolId) {
      setConfirmDeleteId(toolId);
      return;
    }
    setConfirmDeleteId(null);
    setDeleteError(null);
    deleteTool(toolId, {
      onSuccess: () => {
        if (selectedId === toolId) setSelectedId(null);
      },
      onError: (err) =>
        setDeleteError(err instanceof Error ? err.message : 'Failed to delete tool'),
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Tools</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            HTTP endpoints your workspace can call, with per-tool timeouts, retries, and
            optional admin approval.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Tool
        </Button>
      </div>

      <CreateToolDialog open={createOpen} onOpenChange={setCreateOpen} workspaceId={workspaceId} />

      {deleteError && (
        <p role="alert" className="text-sm text-destructive">
          {deleteError}
        </p>
      )}

      {tools.length === 0 ? (
        <EmptyState
          icon={<Wrench />}
          title="No tools yet"
          description="Create an HTTP tool to let this workspace call an external API."
          action={
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New Tool
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            {tools.map((tool) => (
              <div
                key={tool.id}
                className={
                  'rounded-lg border p-4 transition-colors ' +
                  (selectedId === tool.id
                    ? 'border-primary bg-accent/50'
                    : 'border-border bg-card hover:bg-accent/30')
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSelectedId(tool.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{tool.displayName}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                        {tool.type}
                      </span>
                      {tool.requiresApproval && (
                        <span
                          title="Requires approval"
                          className="flex items-center gap-1 rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400"
                        >
                          <ShieldCheck aria-hidden className="h-3 w-3" />
                          approval
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {tool.description}
                    </p>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={
                      confirmDeleteId === tool.id
                        ? `Confirm delete ${tool.displayName}`
                        : `Delete ${tool.displayName}`
                    }
                    className={confirmDeleteId === tool.id ? 'text-destructive' : ''}
                    onClick={() => handleDelete(tool.id)}
                  >
                    {confirmDeleteId === tool.id ? (
                      <span className="text-xs">Confirm?</span>
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {selectedTool ? (
              <>
                <ToolExecutor workspaceId={workspaceId} tool={selectedTool} />
                <div className="rounded-lg border border-border bg-card p-4">
                  <h3 className="mb-2 text-sm font-semibold">Recent executions</h3>
                  <ExecutionHistory workspaceId={workspaceId} toolId={selectedTool.id} />
                </div>
              </>
            ) : (
              <EmptyState
                icon={<Wrench />}
                title="Select a tool"
                description="Pick a tool from the list to run it and see its execution history."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
