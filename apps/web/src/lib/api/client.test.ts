import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiRequest, api, ApiError } from './client';
import { setTokens, getAccessToken, getRefreshToken, clearTokens } from '../auth/token-storage';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiRequest', () => {
  beforeEach(() => {
    clearTokens();
    vi.restoreAllMocks();
  });

  it('returns unwrapped data on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: { hello: 'world' } }))
    );
    const data = await apiRequest<{ hello: string }>('/api/test');
    expect(data).toEqual({ hello: 'world' });
  });

  it('throws ApiError with backend error details on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
        })
      )
    );
    const promise = apiRequest('/api/test', { method: 'POST', body: {} });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
    });
  });

  it('throws ApiError on a non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gateway error', { status: 502 })));
    await expect(apiRequest('/api/test')).rejects.toMatchObject({ status: 502 });
  });

  it('attaches the bearer token when present', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/protected');
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer access-1');
  });

  it('refreshes on 401 and retries the request once', async () => {
    setTokens({ accessToken: 'expired', refreshToken: 'refresh-1' });
    const fetchMock = vi
      .fn()
      // original request → 401
      .mockResolvedValueOnce(
        jsonResponse(401, { success: false, error: { message: 'Unauthorized' } })
      )
      // refresh → new tokens
      .mockResolvedValueOnce(
        jsonResponse(200, {
          success: true,
          data: { accessToken: 'access-2', refreshToken: 'refresh-2' },
        })
      )
      // retry → success
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await apiRequest<{ ok: boolean }>('/api/protected');
    expect(data).toEqual({ ok: true });
    expect(getAccessToken()).toBe('access-2');
    expect(getRefreshToken()).toBe('refresh-2');

    const retryHeaders = fetchMock.mock.calls[2][1].headers as Record<string, string>;
    expect(retryHeaders['Authorization']).toBe('Bearer access-2');
  });

  it('clears tokens and surfaces the 401 when refresh fails', async () => {
    setTokens({ accessToken: 'expired', refreshToken: 'refresh-dead' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(401, { success: false, error: { message: 'Unauthorized' } })
      )
      .mockResolvedValueOnce(
        jsonResponse(401, { success: false, error: { message: 'Invalid refresh token' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/protected')).rejects.toMatchObject({ status: 401 });
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('does not attempt refresh for anonymous requests', async () => {
    setTokens({ accessToken: 'x', refreshToken: 'y' });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { success: false, error: { message: 'Unauthorized' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/auth/login', { anonymous: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends FormData bodies as-is, without a manually set Content-Type', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);

    const formData = new FormData();
    formData.append('avatar', new Blob(['fake'], { type: 'image/png' }), 'avatar.png');

    await api.upload('/api/users/me/avatar', formData);

    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit.body).toBe(formData);
    expect((requestInit.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});
