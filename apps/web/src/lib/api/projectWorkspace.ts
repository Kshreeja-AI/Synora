'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from './client';

/**
 * A project seen as the work inside it.
 *
 * Before this, opening a project showed the files it held. That answered
 * "what was produced" and never "how", "why", or "what is still
 * unfinished" — so people kept those answers in their heads and
 * re-explained them to the AI every time they came back.
 */

export type ProjectItemKind =
  | 'conversation'
  | 'canvas'
  | 'file'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'agentRun'
  | 'note';

export interface ProjectTimelineEntry {
  kind: ProjectItemKind;
  id: string;
  title: string;
  /** ISO. When it last changed — what "recent" means to a person. */
  at: string;
  detail?: string;
}

export interface ProjectWorkspace {
  project: {
    id: string;
    name: string;
    description: string | null;
    /** What "done" looks like, in the person's own words. */
    goal: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  counts: Record<ProjectItemKind, number>;
  timeline: ProjectTimelineEntry[];
  /** Where to pick up. Null when there is nothing to continue. */
  resumeConversationId: string | null;
  lastActivityAt: string | null;
  /**
   * What's new since this person was last here. Null on a first-ever
   * visit — there is no "since" to measure against yet. A returning
   * visit always gets one, even with `count: 0`: "nothing changed" is a
   * fact, not the same thing as "never been here."
   */
  newSinceLastVisit: ProjectVisitDigest | null;
  /**
   * The decision log, whole: full verbatim content (the timeline
   * truncates titles), never crowded out by other activity. Newest first.
   */
  decisions: ProjectDecision[];
}

export interface ProjectDecision {
  id: string;
  content: string;
  author: string | null;
  at: string;
  correction: boolean;
  correctedLater: boolean;
}

export interface ProjectVisitDigest {
  previousVisitAt: string;
  count: number;
  byKind: Partial<Record<ProjectItemKind, number>>;
}

export const PROJECT_WORKSPACE_KEY = 'project-workspace';

export function useProjectWorkspace(
  projectId: string,
  options?: { enabled?: boolean },
): UseQueryResult<ProjectWorkspace> {
  return useQuery({
    queryKey: [PROJECT_WORKSPACE_KEY, projectId],
    queryFn: () => api.get<ProjectWorkspace>(`/api/projects/${projectId}/workspace`),
    enabled: !!projectId && options?.enabled !== false,
  });
}

export function useAddProjectNote(projectId: string): UseMutationResult<
  { id: string; createdAt: string },
  Error,
  { content: string; correctsNoteId?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    // A correction is a NEW note pointing at the one it corrects — the
    // original is never edited or deleted, only marked in the timeline.
    mutationFn: (input: { content: string; correctsNoteId?: string }) =>
      api.post<{ id: string; createdAt: string }>(`/api/projects/${projectId}/notes`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PROJECT_WORKSPACE_KEY, projectId] });
    },
  });
}
