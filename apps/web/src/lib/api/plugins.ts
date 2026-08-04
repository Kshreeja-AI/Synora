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
  | 'workspace:read'
  | 'code:execute'
  | 'network:outbound';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: string;
  permissions: PluginPermission[];
  contributions: { templates?: AgentTemplate[] };
  entryPoint?: string;
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

export function useInstallPlugin(
  workspaceId: string,
): UseMutationResult<InstalledPlugin, Error, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (manifest) =>
      api.post<InstalledPlugin>(`/api/workspaces/${workspaceId}/plugins`, { manifest }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, workspaceId] });
      // A plugin can contribute templates, so that list is now stale too.
      queryClient.invalidateQueries({ queryKey: ['agent-templates', workspaceId] });
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
