'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from './client';
import type { AgentTemplate } from './agentTemplates';

/**
 * Plugins: declarative packages that contribute to a workspace.
 *
 * They do NOT run code, and this client must never imply that they do. A
 * manifest declaring an entry point is refused by the server with an
 * explanation, and the UI shows that explanation rather than a generic
 * failure.
 */

export type PluginPermission =
  | 'templates:contribute'
  | 'tools:contribute'
  | 'workspace:read'
  | 'code:execute'
  | 'network:outbound';

export interface PluginToolContribution {
  name: string;
  displayName: string;
  description: string;
  type: 'HTTP' | 'Webhook';
  config: Record<string, unknown>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: string;
  permissions: PluginPermission[];
  contributions: { templates?: AgentTemplate[]; tools?: PluginToolContribution[] };
  entryPoint?: string;
}

/**
 * What a manifest would do, fetched BEFORE installing.
 *
 * The hosts matter more than anything else here. A contributed tool sends
 * a request to a destination the publisher chose, and "contributes 1 tool"
 * is not something anyone can meaningfully agree to — a host name is.
 */
export interface PluginPreview {
  id: string;
  name: string;
  version: string;
  publisher: string;
  permissions: PluginPermission[];
  templates: { id: string; name: string; kind: string }[];
  tools: {
    name: string;
    displayName: string;
    description: string;
    type: string;
    url: string | null;
  }[];
  hosts: string[];
}

/** The tool rows a lifecycle change created, removed, or could not add. */
export interface PluginToolSync {
  active: string[];
  deactivated: string[];
  skipped: { name: string; reason: string }[];
}

export interface InstalledPlugin {
  id: string;
  workspaceId: string;
  manifest: PluginManifest;
  state: 'enabled' | 'disabled';
  /** Exactly what was declared at install; never widened afterwards. */
  grantedPermissions: PluginPermission[];
  installedBy: string;
  installedAt: number;
  updatedAt: number;
}

export interface PluginListing {
  installed: InstalledPlugin[];
  grantablePermissions: PluginPermission[];
  /** Declared but not grantable: they need an isolate that does not exist. */
  unavailablePermissions: PluginPermission[];
}

const KEY = 'plugins';

export function usePlugins(
  workspaceId: string,
  options?: { enabled?: boolean },
): UseQueryResult<PluginListing> {
  return useQuery({
    queryKey: [KEY, workspaceId],
    queryFn: () => api.get<PluginListing>(`/api/workspaces/${workspaceId}/plugins`),
    enabled: !!workspaceId && options?.enabled !== false,
  });
}

/**
 * Asks what a manifest would do without doing it. Validation runs server
 * side here too, so a manifest that will be refused is refused now rather
 * than after someone has agreed to install it.
 */
export function usePreviewPlugin(
  workspaceId: string,
): UseMutationResult<PluginPreview, Error, unknown> {
  return useMutation({
    mutationFn: (manifest) =>
      api.post<PluginPreview>(`/api/workspaces/${workspaceId}/plugins/preview`, { manifest }),
  });
}

export function useInstallPlugin(
  workspaceId: string,
): UseMutationResult<InstalledPlugin & { tools?: PluginToolSync; hosts?: string[] }, Error, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (manifest) =>
      api.post<InstalledPlugin & { tools?: PluginToolSync; hosts?: string[] }>(
        `/api/workspaces/${workspaceId}/plugins`,
        { manifest },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
      // A plugin can contribute templates, so that list is now stale too.
      queryClient.invalidateQueries({ queryKey: ['agent-templates', workspaceId] });
      // ...and tools, which are real rows the tools page lists.
      queryClient.invalidateQueries({ queryKey: ['tools', workspaceId] });
    },
  });
}

export function useSetPluginEnabled(
  workspaceId: string,
): UseMutationResult<InstalledPlugin, Error, { pluginId: string; enabled: boolean }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pluginId, enabled }) =>
      api.patch<InstalledPlugin>(`/api/workspaces/${workspaceId}/plugins/${pluginId}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['agent-templates', workspaceId] });
    },
  });
}

export function useUninstallPlugin(
  workspaceId: string,
): UseMutationResult<{ uninstalled: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pluginId) =>
      api.delete<{ uninstalled: boolean }>(`/api/workspaces/${workspaceId}/plugins/${pluginId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['agent-templates', workspaceId] });
    },
  });
}
