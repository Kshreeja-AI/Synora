import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiRequest, api, ApiError } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiRequest', () => {
  beforeEach(() => {
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

  it('sends credentials with fetch (HttpOnly cookies)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/protected');
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit.credentials).toBe('include');
  });

  it('refreshes on 401 and retries the request once', async () => {
    const fetchMock = vi
      .fn()
      // original request → 401
      .mockResolvedValueOnce(
        jsonResponse(401, { success: false, error: { message: 'Unauthorized' } })
      )
      // refresh → 200 (new accessToken cookie set by backend)
      .mockResolvedValueOnce(
        jsonResponse(200, { success: true, data: {} })
      )
      // retry → success
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await apiRequest<{ ok: boolean }>('/api/protected');
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces the 401 when refresh fails', async () => {
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
  });

  it('does not attempt refresh for anonymous requests', async () => {
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
