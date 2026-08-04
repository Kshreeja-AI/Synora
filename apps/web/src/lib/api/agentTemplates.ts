'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from './client';
import type { Agent, PlannedStep } from './agents';
import type { WorkflowDefinition } from './workflows';

/**
 * Agent and workflow templates: starting configurations that instantiate
 * into the real thing.
 *
 * Deliberately a separate module and a separate wire path from
 * `templates.ts`, which is conversation templates. They are different
 * ideas — a conversation template starts a chat; these start an agent or a
 * workflow — and the backend paths already collide if both claim the word
 * "templates".
 *
 * `suggestedTools` are plain capability names, never tool ids. A template
 * cannot name a tool that may not exist in this workspace, so what it
 * creates is generate-only and the user wires tools up afterwards.
 */

export type AgentTemplateCategory =
  | 'writing'
  | 'research'
  | 'analysis'
  | 'operations'
  | 'code';

export interface AgentTemplate {
  id: string;
  kind: 'agent' | 'workflow';
  name: string;
  description: string;
  category: AgentTemplateCategory;
  /** The user outcome this serves, in their words. */
  outcome: string;
  instructions: string;
  suggestedTools: string[];
  /** Workflow templates only. */
  steps?: PlannedStep[];
}

export type InstantiateResult = { droppedTools: string[] } & (
  | { kind: 'agent'; agent: Agent }
  | { kind: 'workflow'; workflow: WorkflowDefinition }
);

export interface SaveTemplateInput {
  agentId?: string;
  workflowId?: string;
  name?: string;
  description?: string;
  category?: AgentTemplateCategory;
  outcome?: string;
}

const AGENT_TEMPLATES_KEY = 'agent-templates';

export function useAgentTemplates(
  workspaceId: string,
  options?: { kind?: 'agent' | 'workflow'; enabled?: boolean },
): UseQueryResult<AgentTemplate[]> {
  const kind = options?.kind;
  return useQuery({
    queryKey: [AGENT_TEMPLATES_KEY, workspaceId, kind ?? 'all'],
    queryFn: () =>
      api.get<AgentTemplate[]>(
        `/api/workspaces/${workspaceId}/agent-templates${kind ? `?kind=${kind}` : ''}`,
      ),
    enabled: !!workspaceId && options?.enabled !== false,
  });
}

/**
 * Saves an agent or workflow as a starting point for future ones.
 *
 * A workspace template MAY carry real tool ids, unlike the built-in
 * catalogue — it never leaves the workspace where those ids mean
 * something. Tools are re-checked when the template is used, and any that
 * have been deleted since come back as `droppedTools` rather than being
 * granted dead or dropped in silence.
 */
export function useSaveAsTemplate(
  workspaceId: string,
): UseMutationResult<AgentTemplate, Error, SaveTemplateInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      api.post<AgentTemplate>(`/api/workspaces/${workspaceId}/agent-templates`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [AGENT_TEMPLATES_KEY, workspaceId] });
    },
  });
}

export function useDeleteTemplate(
  workspaceId: string,
): UseMutationResult<{ deleted: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId) =>
      api.delete<{ deleted: boolean }>(
        `/api/workspaces/${workspaceId}/agent-templates/${templateId}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [AGENT_TEMPLATES_KEY, workspaceId] });
    },
  });
}

export function useInstantiateTemplate(
  workspaceId: string,
): UseMutationResult<InstantiateResult, Error, { templateId: string; name?: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, name }) =>
      api.post<InstantiateResult>(
        `/api/workspaces/${workspaceId}/agent-templates/${templateId}/instantiate`,
        name ? { name } : {},
      ),
    onSuccess: () => {
      // What was created is an ordinary agent or workflow, so it is the
      // ordinary lists that are now stale.
      queryClient.invalidateQueries({ queryKey: ['agents', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workflows', workspaceId] });
    },
  });
}
