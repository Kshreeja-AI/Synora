'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Loader2, Plus, Trash2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@synora/design-system';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeySummary,
  type CreateApiKeyResponse,
} from '@/lib/api/apiKeys';

/**
 * Developer portal — workspace-scoped API keys.
 *
 * The raw secret is returned by the create endpoint exactly once. This page
 * surfaces it in a modal with a copy affordance and a clear "won't be shown
 * again" warning, then discards it from local state as soon as the modal
 * closes. All subsequent renders show only the prefix.
 */
export default function DeveloperPage() {
  const { currentWorkspace, isLoading: wsLoading } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id ?? '';
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['api-keys', workspaceId],
    queryFn: () => listApiKeys(workspaceId),
    enabled: !!workspaceId,
  });
  const keys: ApiKeySummary[] = data?.keys ?? [];

  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [justCreated, setJustCreated] = useState<CreateApiKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () => createApiKey(workspaceId, { name: newKeyName.trim() }),
    onSuccess: (res) => {
      setJustCreated(res);
      setNewKeyName('');
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['api-keys', workspaceId] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to create API key'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(workspaceId, id),
    onSuccess: () => {
      toast.success('Key revoked');
      qc.invalidateQueries({ queryKey: ['api-keys', workspaceId] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to revoke key'),
  });

  const copySecret = async () => {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.rawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Developer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            API keys for programmatic access to{' '}
            {currentWorkspace ? (
              <span className="font-medium text-foreground">{currentWorkspace.name}</span>
            ) : (
              'this workspace'
            )}
            . Keys carry the workspace&apos;s access — treat them like passwords.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} disabled={!workspaceId}>
          <Plus className="mr-1 h-4 w-4" /> New API key
        </Button>
      </header>

      <section aria-labelledby="quickstart-heading" className="rounded-lg border border-border bg-muted/30 p-4">
        <h2 id="quickstart-heading" className="text-sm font-medium text-foreground">
          Quickstart
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Send your key as a bearer token on any Synora API request:
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-background px-3 py-2 text-xs">
          <code>{`curl -H "Authorization: Bearer sk_syn_..." \\\n     ${
            typeof window === 'undefined' ? '<api-base>' : window.location.origin.replace(':3000', ':3001')
          }/api/workspaces/${workspaceId || '<workspace-id>'}/conversations`}</code>
        </pre>
      </section>

      {wsLoading || isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading API keys…
        </div>
      ) : error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Could not load API keys.
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          <KeyRound className="mx-auto mb-2 h-6 w-6" />
          <div>No API keys yet.</div>
          <div className="mt-1 text-xs">Create one to authenticate machine-to-machine requests.</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Prefix</th>
                <th className="px-3 py-2">Last used</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const revoked = k.revokedAt !== null;
                const expired = k.expiresAt !== null && new Date(k.expiresAt).getTime() <= Date.now();
                return (
                  <tr key={k.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{k.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {k.prefix}
                      <span className="text-muted-foreground">…</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">
                      {revoked ? (
                        <span className="text-destructive">Revoked</span>
                      ) : expired ? (
                        <span className="text-amber-500">Expired</span>
                      ) : (
                        <span className="text-emerald-500">Active</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!revoked ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(k.id)}
                          title="Revoke key"
                        >
                          <Trash2 className="mr-1 h-3 w-3" /> Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      {showCreate ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
            <h2 className="text-lg font-semibold">New API key</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Give it a name that describes where it will be used.
            </p>
            <input
              autoFocus
              aria-label="Key name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Production server"
              className="mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newKeyName.trim()) create.mutate();
              }}
              disabled={create.isPending}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)} disabled={create.isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => create.mutate()}
                loading={create.isPending}
                disabled={!newKeyName.trim()}
              >
                Create key
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reveal-once dialog. Clearing state on close is deliberate — the raw
          key must not survive in memory once the modal is dismissed. */}
      {justCreated ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
            <h2 className="text-lg font-semibold">Save your API key</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This is the only time we&apos;ll show the full secret. Copy it now and store it
              somewhere safe.
            </p>
            <div className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
              <div className="break-all">{justCreated.rawKey}</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={copySecret} disabled={copied}>
                {copied ? (
                  <>
                    <Check className="mr-1 h-4 w-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-4 w-4" /> Copy
                  </>
                )}
              </Button>
              <Button onClick={() => setJustCreated(null)}>I&apos;ve saved it</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
