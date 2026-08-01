import { describe, it, expect } from 'vitest';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './token-storage';

describe('token-storage', () => {
  it('tokens are in HttpOnly cookies, not accessible to JS', () => {
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('setTokens is a no-op (cookies set by backend)', () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('clearTokens is a no-op (cookies cleared by backend)', () => {
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});
