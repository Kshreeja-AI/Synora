import { describe, it, expect, beforeEach } from 'vitest';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './token-storage';

describe('token-storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null when no tokens are stored', () => {
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('stores and retrieves both tokens', () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    expect(getAccessToken()).toBe('a');
    expect(getRefreshToken()).toBe('r');
  });

  it('clears both tokens', () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});
