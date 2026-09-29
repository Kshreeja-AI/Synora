/**
 * The Ollama descriptor against a REAL wire — the mock GPU box.
 *
 * The unit tests prove the token reaches the SDK constructor. These prove
 * what actually matters for a remote deployment: the token arrives ON THE
 * WIRE as a Bearer header, generation round-trips through a protected
 * endpoint, and a missing token surfaces as a provider auth failure rather
 * than anything vaguer. Same tests, real endpoint later: only env changes.
 *
 * NOTE: unlike ollama.provider.test.ts, the OpenAI SDK here is REAL.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));
vi.mock('../../config', () => ({ getConfig: getConfigMock }));

import { ollamaDescriptor } from './ollama.provider';
import { verifyProvider } from '../verification';
import { AIProviderError } from '../types';
import { startMockOpenAIServer, type MockOpenAIServer } from '../../test-support/mockOpenAIServer';

describe('ollama against a token-protected endpoint', () => {
  let server: MockOpenAIServer;

  beforeAll(async () => {
    server = await startMockOpenAIServer({
      requireAuth: 'gpu-proxy-token',
      models: ['llama3.1', 'qwen2.5'],
      completionText: 'remote hello',
    });
  });

  afterAll(async () => {
    await server.close();
  });

  function config(ollamaApiKey?: string): void {
    getConfigMock.mockReturnValue({
      ai: { ollamaBaseUrl: server.baseUrl, ollamaModel: 'llama3.1', ollamaApiKey },
    });
  }

  it('generates through the protected endpoint with the token ON THE WIRE', async () => {
    config('gpu-proxy-token');
    const provider = await ollamaDescriptor.create();

    const result = await provider.generateText({ prompt: 'hello' });

    expect(result.text).toBe('remote hello');
    expect(result.provider).toBe('ollama');
    // The evidence, from the server's side of the wire — not from a mock's
    // recollection of what it was configured with.
    const call = server.requests.find((r) => r.path === '/v1/chat/completions');
    expect(call?.authorization).toBe('Bearer gpu-proxy-token');
  });

  it('honours a per-request model override — one endpoint, several models', async () => {
    config('gpu-proxy-token');
    const provider = await ollamaDescriptor.create();

    await provider.generateText({ prompt: 'hi', model: 'qwen2.5' });

    const call = server.requests[server.requests.length - 1];
    expect((call.body as { model: string }).model).toBe('qwen2.5');
  });

  it('surfaces a missing token as a provider auth failure, not something vaguer', async () => {
    config(undefined);
    const provider = await ollamaDescriptor.create();

    await expect(provider.generateText({ prompt: 'hello' })).rejects.toBeInstanceOf(
      AIProviderError
    );
  });

  it('readiness reports verified with the right token', async () => {
    config('gpu-proxy-token');
    // Through the PRODUCTION surface (verifyProvider), which owns the
    // throw→classification mapping — not the bare descriptor hook.
    await expect(verifyProvider(ollamaDescriptor)).resolves.toMatchObject({
      status: 'verified',
    });
  });

  it('readiness reports rejected — not unreachable — with a wrong token', async () => {
    config('wrong-token');
    // The four-outcome honesty rule: a refused credential must never read
    // as a network blip, or it gets ignored until it breaks production.
    await expect(verifyProvider(ollamaDescriptor)).resolves.toMatchObject({
      status: 'rejected',
    });
  });
});
