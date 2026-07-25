import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './auth-store';

describe('auth-store', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, status: 'loading' });
  });

  it('starts in loading state with no user', () => {
    const { user, status } = useAuthStore.getState();
    expect(user).toBeNull();
    expect(status).toBe('loading');
  });

  it('setSession stores the user and marks authenticated', () => {
    useAuthStore.getState().setSession({ id: 'u1', email: 'a@b.co', name: 'Ada' });
    const { user, status } = useAuthStore.getState();
    expect(user?.email).toBe('a@b.co');
    expect(status).toBe('authenticated');
  });

  it('clearSession resets the user and marks unauthenticated', () => {
    useAuthStore.getState().setSession({ id: 'u1', email: 'a@b.co', name: null });
    useAuthStore.getState().clearSession();
    const { user, status } = useAuthStore.getState();
    expect(user).toBeNull();
    expect(status).toBe('unauthenticated');
  });
});
