import { create } from 'zustand';
import type { AuthUser } from '../lib/api/types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  setSession: (user: AuthUser) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  setSession: (user) => set({ user, status: 'authenticated' }),
  clearSession: () => set({ user: null, status: 'unauthenticated' }),
}));
