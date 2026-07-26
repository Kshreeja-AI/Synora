import { create } from 'zustand';

interface CreateWorkspaceDialogState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/** Shared so both the sidebar's workspace switcher and the command palette can open the same dialog instance. */
export const useCreateWorkspaceStore = create<CreateWorkspaceDialogState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
