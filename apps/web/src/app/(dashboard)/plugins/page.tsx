'use client';

import { useState } from 'react';
import { Globe, Loader2, Pause, Play, Plug, Trash2, Wrench } from 'lucide-react';
import { Button, EmptyState, Spinner } from '@synora/design-system';
import { toast } from 'sonner';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import {
  useInstallPlugin,
  usePlugins,
  usePreviewPlugin,
  useSetPluginEnabled,
  useUninstallPlugin,
  type PluginPreview,
} from '@/lib/api/plugins';

/**
 * Installed plugins.
 *
 * WHAT THIS PAGE MUST NOT IMPLY. There is no marketplace, so there is no
 * browse-and-install flow pretending one exists — installing takes a
 * manifest, which is what a publisher actually hands you today. And
 * plugins do not run code: the page says so, because a user who assumes
 * otherwise would install something expecting behaviour it cannot have.
 *
 * INSTALLING IS TWO STEPS, DELIBERATELY. A plugin can contribute a tool,
 * and a tool sends requests to a host the PUBLISHER chose. Being shown
 * that host after the tool exists is being informed; being shown it before
 * agreeing is consent. So the manifest is previewed first, the
 * destinations are named, and only then is there an install button.
 *
 * The server's refusal messages are shown verbatim. "This plugin wants to
 * run code, which Synora cannot do safely yet" is the useful answer;
 * "invalid manifest" would send someone hunting for a typo.
 */
export default function PluginsPage() {
  const { currentWorkspace } = useCurrentWorkspace();
  const workspaceId = currentWorkspace?.id || '';

  const [manifestText, setManifestText] = useState('');
  const [pasting, setPasting] = useState(false);
  /** Set once the manifest has been read back; cleared when the text changes. */
  const [preview, setPreview] = useState<PluginPreview | null>(null);

  const { data, isLoading } = usePlugins(workspaceId);
  const previewPlugin = usePreviewPlugin(workspaceId);
  const install = useInstallPlugin(workspaceId);
  const setEnabled = useSetPluginEnabled(workspaceId);
  const uninstall = useUninstallPlugin(workspaceId);

  const installed = data?.installed ?? [];

  /** Shared by both steps: the text has to be JSON before anything else. */
  function parseManifest(): unknown | undefined {
    try {
      return JSON.parse(manifestText);
    } catch {
      // Distinguished from a server refusal on purpose: this one is about
      // the text, not about the plugin.
      toast.error('That is not valid JSON');
      return undefined;
    }
  }

  function review() {
    const parsed = parseManifest();
    if (parsed === undefined) return;
    previewPlugin.mutate(parsed, {
      onSuccess: setPreview,
      // A manifest that would be refused is refused here, with the same
      // message, rather than after someone has agreed to install it.
      onError: (e) => toast.error(e.message),
    });
  }

  function submit() {
    const parsed = parseManifest();
    if (parsed === undefined) return;
    install.mutate(parsed, {
      onSuccess: (result) => {
        const skipped = result.tools?.skipped ?? [];
        if (skipped.length > 0) {
          // Reported, not swallowed: a plugin that contributed three of
          // its four tools would otherwise look like it worked.
          toast.warning(
            `Installed, but ${skipped.length} tool${skipped.length === 1 ? '' : 's'} could not be added: ${skipped
              .map((s) => `${s.name} — ${s.reason}`)
              .join('; ')}`,
          );
        } else {
          toast.success('Plugin installed');
        }
        setManifestText('');
        setPreview(null);
        setPasting(false);
      },
      onError: (e) => toast.error(e.message),
    });
  }

  if (!workspaceId) {
    return (
      <div className="p-6">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Plugins</h1>
          <p className="text-sm text-muted-foreground">
            Packages that add templates and capabilities to this workspace.
          </p>
        </div>
        <Button onClick={() => setPasting((v) => !v)}>Install from manifest</Button>
      </div>

      <div
        role="note"
        className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
      >
        <p className="font-semibold">Plugins do not run code</p>
        <p>
          A plugin describes what it adds; Synora reads that description. Running third-party
          code safely needs an isolated runtime that does not exist yet, and calling anything
          less a “sandbox” would claim a protection that is not there. A manifest asking to run
          code is refused.
        </p>
      </div>

      {pasting && (
        <div className="space-y-2 rounded-md border p-4">
          <label htmlFor="plugin-manifest" className="text-sm font-medium">
            Manifest (JSON)
          </label>
          <textarea
            id="plugin-manifest"
            value={manifestText}
            onChange={(e) => {
              setManifestText(e.target.value);
              // Any edit invalidates what was reviewed. Keeping a stale
              // preview beside changed text would let someone agree to one
              // manifest and install another.
              setPreview(null);
            }}
            rows={10}
            className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
            placeholder='{"id":"publisher.name","name":"…","version":"1.0.0","publisher":"…","description":"…","permissions":[],"contributions":{}}'
          />
          <p className="text-xs text-muted-foreground">
            There is no marketplace yet, so a manifest is what a publisher hands you. When a
            registry exists it becomes another way to obtain one; this path stays.
          </p>

          {preview && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              <p className="font-semibold">
                Before you install {preview.name} v{preview.version}
              </p>
              <p className="text-xs">
                Published by {preview.publisher}. Requests{' '}
                {preview.permissions.length === 0
                  ? 'no permissions'
                  : preview.permissions.join(', ')}
                .
              </p>

              {preview.templates.length > 0 && (
                <p className="text-xs">
                  Adds {preview.templates.length} template
                  {preview.templates.length === 1 ? '' : 's'}:{' '}
                  {preview.templates.map((t) => t.name).join(', ')}.
                </p>
              )}

              {preview.tools.length > 0 && (
                <div className="space-y-1">
                  <p className="flex items-center gap-1 text-xs font-semibold">
                    <Wrench className="h-3 w-3" aria-hidden />
                    Adds {preview.tools.length} tool
                    {preview.tools.length === 1 ? '' : 's'} that send requests when used
                  </p>
                  <ul className="space-y-1">
                    {preview.tools.map((t) => (
                      <li key={t.name} className="text-xs">
                        <span className="font-medium">{t.displayName}</span> — {t.description}
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {t.type} {t.url}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.hosts.length > 0 && (
                <p className="text-xs">
                  <Globe className="mr-1 inline h-3 w-3" aria-hidden />
                  These tools will contact{' '}
                  <span className="font-mono">{preview.hosts.join(', ')}</span>. Every one of them
                  asks a person to approve each run before it goes out — a plugin cannot waive
                  that, though you can change it later on the tool itself.
                </p>
              )}

              {preview.templates.length === 0 && preview.tools.length === 0 && (
                <p className="text-xs">This plugin contributes nothing to the workspace.</p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            {!preview ? (
              <Button
                onClick={review}
                disabled={previewPlugin.isPending || manifestText.trim() === ''}
              >
                {previewPlugin.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Review manifest
              </Button>
            ) : (
              <Button onClick={submit} disabled={install.isPending}>
                {install.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Install
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setPasting(false);
                setPreview(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : installed.length === 0 ? (
        <EmptyState
          icon={<Plug className="h-8 w-8" />}
          title="No plugins installed"
          description="A plugin can contribute agent and workflow templates to this workspace. Install one from its manifest."
        />
      ) : (
        <ul className="space-y-2">
          {installed.map((p) => (
            <li key={p.id} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.manifest.name}</span>
                <span className="text-xs text-muted-foreground">
                  {p.manifest.publisher} · v{p.manifest.version}
                </span>
                <span
                  className={
                    p.state === 'enabled'
                      ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                      : 'rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                  }
                >
                  {p.state}
                </span>
                <span className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={p.state === 'enabled' ? 'Disable plugin' : 'Enable plugin'}
                  onClick={() =>
                    setEnabled.mutate(
                      { pluginId: p.manifest.id, enabled: p.state !== 'enabled' },
                      { onError: (e) => toast.error(e.message) },
                    )
                  }
                >
                  {p.state === 'enabled' ? (
                    <Pause className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Uninstall plugin"
                  onClick={() =>
                    uninstall.mutate(p.manifest.id, {
                      onSuccess: () => toast.success('Plugin uninstalled'),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              <p className="text-sm text-muted-foreground">{p.manifest.description}</p>

              <p className="text-xs text-muted-foreground">
                {p.grantedPermissions.length === 0
                  ? 'Requested no permissions.'
                  : `Granted: ${p.grantedPermissions.join(', ')}`}
                {p.state !== 'enabled' && ' — none of which apply while it is disabled.'}
              </p>

              {(p.manifest.contributions.templates?.length ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Contributes {p.manifest.contributions.templates!.length} template
                  {p.manifest.contributions.templates!.length === 1 ? '' : 's'}.
                </p>
              )}

              {(p.manifest.contributions.tools?.length ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Contributes {p.manifest.contributions.tools!.length} tool
                  {p.manifest.contributions.tools!.length === 1 ? '' : 's'}, contacting{' '}
                  <span className="font-mono">
                    {[
                      ...new Set(
                        p.manifest.contributions.tools!.map((t) => {
                          const url = (t.config as { url?: unknown })?.url;
                          try {
                            return new URL(String(url)).host;
                          } catch {
                            return String(url);
                          }
                        }),
                      ),
                    ].join(', ')}
                  </span>
                  .
                  {p.state !== 'enabled' &&
                    ' While disabled, those tools are switched off rather than merely hidden.'}
                  {p.state === 'enabled' &&
                    ' Uninstalling removes them — unlike templates, which stay with whoever built from them.'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
