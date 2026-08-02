'use client';

import { useMemo, useState } from 'react';
import { Button } from '@synora/design-system/components/Button';
import { Input } from '@synora/design-system/components/Input';
import { Textarea } from '@synora/design-system/components/Textarea';
import { Checkbox } from '@synora/design-system/components/Checkbox';
import { Spinner } from '@synora/design-system/components/Spinner';
import {
  useExecuteTool,
  useToolExecution,
  useApproveExecution,
  useRejectExecution,
  isActiveExecution,
  type Tool,
  type ToolExecutionStatus,
} from '@/lib/api/tools';
import { AlertCircle, CheckCircle, Clock, XCircle } from 'lucide-react';

interface ToolExecutorProps {
  workspaceId: string;
  tool: Tool;
  conversationId?: string;
}

interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'json';
  description?: string;
  required: boolean;
  enumValues?: string[];
}

/**
 * Flatten the tool's JSON Schema `properties` into renderable fields.
 * Primitive types get native inputs; anything structured falls back to
 * a JSON textarea for that field.
 */
function schemaToFields(schema: Record<string, unknown> | undefined | null): SchemaField[] {
  if (!schema || typeof schema !== 'object') return [];
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties || typeof properties !== 'object') return [];
  const required = new Set((schema.required as string[] | undefined) ?? []);

  return Object.entries(properties).map(([name, prop]) => {
    const rawType = typeof prop.type === 'string' ? prop.type : 'json';
    const type =
      rawType === 'string' || rawType === 'number' || rawType === 'integer' || rawType === 'boolean'
        ? rawType
        : 'json';
    const enumValues = Array.isArray(prop.enum)
      ? prop.enum.filter((v): v is string => typeof v === 'string')
      : undefined;
    return {
      name,
      type,
      description: typeof prop.description === 'string' ? prop.description : undefined,
      required: required.has(name),
      enumValues: enumValues && enumValues.length > 0 ? enumValues : undefined,
    };
  });
}

const STATUS_META: Record<ToolExecutionStatus, { label: string; tone: 'ok' | 'bad' | 'wait' }> = {
  PENDING: { label: 'Waiting for approval', tone: 'wait' },
  APPROVED: { label: 'Approved — starting…', tone: 'wait' },
  RUNNING: { label: 'Running…', tone: 'wait' },
  STREAMING: { label: 'Streaming…', tone: 'wait' },
  COMPLETED: { label: 'Completed', tone: 'ok' },
  FAILED: { label: 'Failed', tone: 'bad' },
  CANCELLED: { label: 'Cancelled', tone: 'bad' },
  TIMEOUT: { label: 'Timed out', tone: 'bad' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
};

function StatusIcon({ status }: { status: ToolExecutionStatus }) {
  const tone = STATUS_META[status].tone;
  if (tone === 'ok') return <CheckCircle aria-hidden className="h-4 w-4 text-green-600" />;
  if (tone === 'bad') {
    return status === 'REJECTED' || status === 'CANCELLED' ? (
      <XCircle aria-hidden className="h-4 w-4 text-red-600" />
    ) : (
      <AlertCircle aria-hidden className="h-4 w-4 text-red-600" />
    );
  }
  return status === 'PENDING' ? (
    <Clock aria-hidden className="h-4 w-4 text-yellow-600" />
  ) : (
    <Spinner size="sm" />
  );
}

export function ToolExecutor({ workspaceId, tool, conversationId }: ToolExecutorProps) {
  const fields = useMemo(() => schemaToFields(tool.inputSchema), [tool.inputSchema]);

  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [boolValues, setBoolValues] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { mutate: executeTool, isPending, error: executeError } = useExecuteTool(
    workspaceId,
    tool.id
  );
  const { data: executionData } = useToolExecution(workspaceId, executionId || '', {
    enabled: !!executionId,
  });
  // Never render cached/stale query data for a run this component
  // hasn't started: no executionId, no execution panel.
  const execution = executionId ? executionData : undefined;
  const approve = useApproveExecution(workspaceId);
  const reject = useRejectExecution(workspaceId);

  const buildInput = (): Record<string, unknown> | null => {
    const input: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === 'boolean') {
        input[field.name] = boolValues[field.name] ?? false;
        continue;
      }
      const raw = (textValues[field.name] ?? '').trim();
      if (raw === '') {
        if (field.required) {
          setFormError(`"${field.name}" is required`);
          return null;
        }
        continue;
      }
      if (field.type === 'number' || field.type === 'integer') {
        const parsed = Number(raw);
        if (Number.isNaN(parsed)) {
          setFormError(`"${field.name}" must be a number`);
          return null;
        }
        input[field.name] = parsed;
      } else if (field.type === 'json') {
        try {
          input[field.name] = JSON.parse(raw);
        } catch {
          setFormError(`"${field.name}" must be valid JSON`);
          return null;
        }
      } else {
        input[field.name] = raw;
      }
    }
    return input;
  };

  const handleExecute = () => {
    setFormError(null);
    const input = buildInput();
    if (input === null) return;

    executeTool(
      { input, conversationId },
      {
        onSuccess: (result) => {
          setExecutionId(result.id);
          setRejectReason('');
        },
      }
    );
  };

  const active = execution ? isActiveExecution(execution.status) : false;
  const actionError = executeError || approve.error || reject.error;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">{tool.displayName}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
      </div>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          handleExecute();
        }}
      >
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">This tool takes no parameters.</p>
        ) : (
          fields.map((field) => (
            <div key={field.name} className="space-y-1">
              <label htmlFor={`tool-field-${field.name}`} className="text-xs font-medium">
                {field.name}
                {field.required && (
                  <span aria-hidden className="ml-0.5 text-destructive">
                    *
                  </span>
                )}
              </label>
              {field.type === 'boolean' ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`tool-field-${field.name}`}
                    checked={boolValues[field.name] ?? false}
                    onCheckedChange={(checked) =>
                      setBoolValues((prev) => ({ ...prev, [field.name]: checked === true }))
                    }
                  />
                  {field.description && (
                    <span className="text-xs text-muted-foreground">{field.description}</span>
                  )}
                </div>
              ) : field.enumValues ? (
                <select
                  id={`tool-field-${field.name}`}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={textValues[field.name] ?? ''}
                  onChange={(event) =>
                    setTextValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                >
                  <option value="">Select…</option>
                  {field.enumValues.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : field.type === 'json' ? (
                <Textarea
                  id={`tool-field-${field.name}`}
                  rows={3}
                  placeholder='{"key": "value"}'
                  value={textValues[field.name] ?? ''}
                  onChange={(event) =>
                    setTextValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                />
              ) : (
                <Input
                  id={`tool-field-${field.name}`}
                  type={field.type === 'string' ? 'text' : 'number'}
                  value={textValues[field.name] ?? ''}
                  onChange={(event) =>
                    setTextValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                />
              )}
              {field.type !== 'boolean' && field.description && (
                <p className="text-xs text-muted-foreground">{field.description}</p>
              )}
            </div>
          ))
        )}

        {formError && (
          <p role="alert" className="text-xs text-destructive">
            {formError}
          </p>
        )}
        {actionError && (
          <p role="alert" className="text-xs text-destructive">
            {actionError instanceof Error ? actionError.message : 'Request failed'}
          </p>
        )}

        <Button type="submit" disabled={isPending || active} className="w-full gap-2">
          {isPending ? (
            <>
              <Spinner size="sm" />
              Submitting…
            </>
          ) : tool.requiresApproval ? (
            'Request Execution'
          ) : (
            'Execute Tool'
          )}
        </Button>
      </form>

      {execution && (
        <div className="space-y-3 rounded-md border border-border bg-background p-3">
          <div className="flex items-center gap-2">
            <StatusIcon status={execution.status} />
            <span className="text-sm font-medium">{STATUS_META[execution.status].label}</span>
            {typeof execution.duration === 'number' && (
              <span className="text-xs text-muted-foreground">{execution.duration}ms</span>
            )}
          </div>

          {execution.status === 'PENDING' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                This tool requires approval from a workspace admin before it runs.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(execution.id)}
                >
                  Approve
                </Button>
                <Input
                  aria-label="Rejection reason"
                  placeholder="Reason"
                  className="h-8 text-xs"
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={reject.isPending || rejectReason.trim().length === 0}
                  onClick={() =>
                    reject.mutate({ executionId: execution.id, reason: rejectReason.trim() })
                  }
                >
                  Reject
                </Button>
              </div>
            </div>
          )}

          {execution.output != null && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">
                Output (HTTP {execution.output.statusCode}):
              </p>
              <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(execution.output.body, null, 2)}
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

          {!active && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setExecutionId(null)}
              className="w-full"
            >
              New Run
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
