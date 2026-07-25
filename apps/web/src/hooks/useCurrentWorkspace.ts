'use client';

import { useEffect } from 'react';
import { useWorkspaces } from './useWorkspaces';
import { useWorkspaceStore } from '../stores/workspace-store';
import type { WorkspaceSummary } from '../lib/api/types';

export interface UseCurrentWorkspaceResult {
  workspaces: WorkspaceSummary[];
  currentWorkspace: WorkspaceSummary | null;
  setCurrentWorkspaceId: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
}

/**
 * The workspace list is always the source of truth (TanStack Query); only
 * the *selected id* is persisted client-side. If the persisted id doesn't
 * match any workspace the user currently belongs to (first visit, or the
 * workspace was left), this falls back to the first workspace and persists
 * that choice instead.
 */
export function useCurrentWorkspace(): UseCurrentWorkspaceResult {
  const workspacesQuery = useWorkspaces();
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((state) => state.setCurrentWorkspaceId);

  const workspaces = workspacesQuery.data ?? [];
  const currentWorkspace =
    workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? workspaces[0] ?? null;

  useEffect(() => {
    if (currentWorkspace && currentWorkspace.id !== currentWorkspaceId) {
      setCurrentWorkspaceId(currentWorkspace.id);
    }
  }, [currentWorkspace, currentWorkspaceId, setCurrentWorkspaceId]);

  return {
    workspaces,
    currentWorkspace,
    setCurrentWorkspaceId,
    isLoading: workspacesQuery.isLoading,
    isError: workspacesQuery.isError,
  };
}
