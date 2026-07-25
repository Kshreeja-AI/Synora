import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkspaceState {
  currentWorkspaceId: string | null;
  setCurrentWorkspaceId: (id: string | null) => void;
}

/**
 * Persists only the *id* of the workspace the user last had selected — the
 * workspace list and details themselves always come from TanStack Query, so
 * this never risks serving stale workspace data from localStorage.
 */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      setCurrentWorkspaceId: (id) => set({ currentWorkspaceId: id }),
    }),
    { name: 'synora-current-workspace' }
  )
);
