'use client';

import { useState } from 'react';
import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';
import { useExecuteTool, useToolExecution } from '@/lib/api/tools';
import { AlertCircle, CheckCircle, Clock } from 'lucide-react';

interface ToolExecutorProps {
  workspaceId: string;
  toolId: string;
  toolName: string;
  inputSchema?: Record<string, unknown>;
  conversationId?: string;
}

export function ToolExecutor({
  workspaceId,
  toolId,
  toolName,
  inputSchema,
  conversationId,
}: ToolExecutorProps) {
  const [executionId, setExecutionId] = useState<string | null>(null);
  const { mutate: executeTool, isPending } = useExecuteTool(workspaceId, toolId);

  const { data: execution } = useToolExecution(
    workspaceId,
    executionId || '',
    { enabled: !!executionId }
  );

  const handleExecute = () => {
    executeTool(
      { input: {}, conversationId },
      {
        onSuccess: (result) => {
          setExecutionId(result.id);
        },
      }
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SUCCESS':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'FAILED':
      case 'REJECTED':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      case 'REQUIRES_APPROVAL':
      case 'PENDING':
      case 'RUNNING':
        return <Clock className="h-4 w-4 text-yellow-600" />;
      default:
        return null;
    }
  };

  if (execution) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          {getStatusIcon(execution.status)}
          <span className="text-sm font-medium">{execution.status}</span>
        </div>

        {execution.output && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Output:</p>
            <pre className="overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(execution.output, null, 2)}
            </pre>
          </div>
        )}

        {execution.error && (
          <div className="rounded bg-destructive/10 p-2">
            <p className="text-xs font-semibold text-destructive">Error:</p>
            <p className="text-xs text-destructive/90">{execution.error}</p>
          </div>
        )}

        {execution.rejectionReason && (
          <div className="rounded bg-destructive/10 p-2">
            <p className="text-xs font-semibold text-destructive">Rejected:</p>
            <p className="text-xs text-destructive/90">{execution.rejectionReason}</p>
          </div>
        )}

        <Button
          type="button"
          size="sm"
          onClick={() => setExecutionId(null)}
          className="w-full"
        >
          Run Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{toolName}</h3>
      </div>

      <div className="space-y-2">
        {inputSchema && Object.keys(inputSchema).length > 0 ? (
          <div className="text-xs text-muted-foreground">
            <p className="mb-2">Parameters:</p>
            <pre className="overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(inputSchema, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No parameters required</p>
        )}
      </div>

      <Button
        type="button"
        onClick={handleExecute}
        disabled={isPending}
        className="w-full gap-2"
      >
        {isPending ? (
          <>
            <Spinner size="sm" />
            Executing...
          </>
        ) : (
          'Execute Tool'
        )}
      </Button>
    </div>
  );
}
