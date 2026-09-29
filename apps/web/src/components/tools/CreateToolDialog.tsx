'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@synora/design-system/components/Dialog';
import { Button } from '@synora/design-system/components/Button';
import { Input } from '@synora/design-system/components/Input';
import { Textarea } from '@synora/design-system/components/Textarea';
import { Checkbox } from '@synora/design-system/components/Checkbox';
import { Spinner } from '@synora/design-system/components/Spinner';
import { useCreateTool, EXECUTABLE_TOOL_TYPES, type Tool } from '@/lib/api/tools';

interface CreateToolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * Creates an HTTP/Webhook tool definition — the two types the backend
 * execution engine actually runs. Headers and input schema are entered
 * as JSON and validated client-side before submit; the backend
 * re-validates everything (name uniqueness, URL shape, permission).
 */
export function CreateToolDialog({ open, onOpenChange, workspaceId }: CreateToolDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<(typeof EXECUTABLE_TOOL_TYPES)[number]>('HTTP');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState<(typeof METHODS)[number]>('POST');
  const [headersJson, setHeadersJson] = useState('');
  const [schemaJson, setSchemaJson] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { mutate: createTool, isPending, error } = useCreateTool(workspaceId);

  const handleDisplayNameChange = (value: string) => {
    setDisplayName(value);
    setName(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    );
  };

  const parseJsonField = (
    label: string,
    raw: string
  ): { ok: true; value: Record<string, unknown> | undefined } | { ok: false } => {
    const trimmed = raw.trim();
    if (trimmed === '') return { ok: true, value: undefined };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setFormError(`${label} must be a JSON object`);
        return { ok: false };
      }
      return { ok: true, value: parsed as Record<string, unknown> };
    } catch {
      setFormError(`${label} is not valid JSON`);
      return { ok: false };
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!displayName.trim() || !name.trim() || !description.trim() || !url.trim()) {
      setFormError('Name, description, and URL are required');
      return;
    }

    const headers = parseJsonField('Headers', headersJson);
    if (!headers.ok) return;
    const schema = parseJsonField('Input schema', schemaJson);
    if (!schema.ok) return;

    const config: Record<string, unknown> = { url: url.trim(), method };
    if (headers.value) config.headers = headers.value;

    createTool(
      {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        category: type.toLowerCase(),
        type: type as Tool['type'],
        inputSchema: schema.value ?? { type: 'object', properties: {} },
        config,
        requiresApproval,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setDisplayName('');
          setName('');
          setDescription('');
          setUrl('');
          setHeadersJson('');
          setSchemaJson('');
          setRequiresApproval(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Tool</DialogTitle>
          <DialogDescription>
            Define an HTTP endpoint your workspace can call as a tool. Executions are
            SSRF-guarded and run with the timeout and retry budget you set here.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="tool-display-name" className="text-xs font-medium">
              Display name
            </label>
            <Input
              id="tool-display-name"
              value={displayName}
              onChange={(event) => handleDisplayNameChange(event.target.value)}
              placeholder="Weather Lookup"
            />
            {name && <p className="text-xs text-muted-foreground">API name: {name}</p>}
          </div>

          <div className="space-y-1">
            <label htmlFor="tool-description" className="text-xs font-medium">
              Description
            </label>
            <Textarea
              id="tool-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this tool does and when to use it"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="tool-type" className="text-xs font-medium">
                Type
              </label>
              <select
                id="tool-type"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={type}
                onChange={(event) =>
                  setType(event.target.value as (typeof EXECUTABLE_TOOL_TYPES)[number])
                }
              >
                {EXECUTABLE_TOOL_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="tool-method" className="text-xs font-medium">
                Method
              </label>
              <select
                id="tool-method"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={method}
                onChange={(event) => setMethod(event.target.value as (typeof METHODS)[number])}
              >
                {METHODS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="tool-url" className="text-xs font-medium">
              URL
            </label>
            <Input
              id="tool-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://api.example.com/v1/lookup"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="tool-headers" className="text-xs font-medium">
              Headers (JSON, optional)
            </label>
            <Textarea
              id="tool-headers"
              rows={2}
              value={headersJson}
              onChange={(event) => setHeadersJson(event.target.value)}
              placeholder='{"Authorization": "Bearer {{secret:API_KEY}}"}'
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="tool-schema" className="text-xs font-medium">
              Input schema (JSON Schema, optional)
            </label>
            <Textarea
              id="tool-schema"
              rows={3}
              value={schemaJson}
              onChange={(event) => setSchemaJson(event.target.value)}
              placeholder='{"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}'
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="tool-requires-approval"
              checked={requiresApproval}
              onCheckedChange={(checked) => setRequiresApproval(checked === true)}
            />
            <label htmlFor="tool-requires-approval" className="text-xs">
              Require admin approval before each execution
            </label>
          </div>

          {formError && (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error instanceof Error ? error.message : 'Failed to create tool'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending && <Spinner size="sm" />}
              Create Tool
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
