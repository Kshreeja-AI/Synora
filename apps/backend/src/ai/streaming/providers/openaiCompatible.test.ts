/**
 * The shared OpenAI-compatible streaming provider, against a real wire.
 *
 * The load-bearing behaviours: SSE tokens arrive in order; server-reported
 * usage is carried when present; ABSENT usage produces the exact
 * "unreported" shape (inputTokens 0 + counted output) the chat worker
 * translates into the spend guard's estimated floor; the Bearer token is
 * on the wire; a refused token maps to a non-retryable INVALID_API_KEY.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));
vi.mock('../../../config', () => ({ getConfig: getConfigMock }));

import { OpenAICompatibleStreamProvider } from './openaiCompatible';
import { StreamChunkType, StreamingError } from '../types';
import { getStreamingResolver } from '../resolver';
import { STREAMING_PROVIDER_IDS_FOR_TESTS } from '../../models';
import {
  startMockOpenAIServer,
  type MockOpenAIServer,
} from '../../../test-support/mockOpenAIServer';

async function collect(provider: OpenAICompatibleStreamProvider, model = 'llama3.1') {
  const chunks = [];
  for await (const chunk of provider.generateStream({
    messages: [{ role: 'user', content: 'hello' }],
    model,
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('OpenAICompatibleStreamProvider', () => {
  let server: MockOpenAIServer;

  beforeAll(async () => {
    server = await startMockOpenAIServer({
      requireAuth: 'stream-token',
      streamTokens: ['A', 'B', 'C'],
    });
  });

  afterAll(async () => {
    await server.close();
  });

  function provider(apiKey?: string): OpenAICompatibleStreamProvider {
    return new OpenAICompatibleStreamProvider('ollama', () => ({
      baseURL: server.baseUrl,
      apiKey,
    }));
  }

  it('streams tokens in order and finishes with a USAGE chunk', async () => {
    const chunks = await collect(provider('stream-token'));
    const tokens = chunks
      .filter((c) => c.type === StreamChunkType.TOKEN)
      .map((c) => c.token);
    expect(tokens).toEqual(['A', 'B', 'C']);
    expect(chunks[chunks.length - 1].type).toBe(StreamChunkType.USAGE);
  });

  it('carries server-reported usage when the server sends it', async () => {
    server.setOptions({ usage: { prompt_tokens: 11, completion_tokens: 7 } });
    const chunks = await collect(provider('stream-token'));
    const usage = chunks[chunks.length - 1];
    expect(usage.inputTokens).toBe(11);
    expect(usage.outputTokens).toBe(7);
  });

  it('produces the exact "unreported" shape when the server omits usage — the Ollama case', async () => {
    server.setOptions({ usage: null });
    const chunks = await collect(provider('stream-token'));
    const usage = chunks[chunks.length - 1];
    // inputTokens 0 + per-token output count: the shape the worker treats
    // as "the provider reported nothing", which routes to the estimated
    // floor rather than reading the whole stream as free.
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(3);
    server.setOptions({ usage: undefined });
  });

  it('asks the server to include usage, and sends the token ON THE WIRE', async () => {
    await collect(provider('stream-token'));
    const call = server.requests[server.requests.length - 1];
    expect(call.authorization).toBe('Bearer stream-token');
    expect(
      (call.body as { stream_options?: { include_usage?: boolean } }).stream_options?.include_usage
    ).toBe(true);
  });

  it('maps a refused token to non-retryable INVALID_API_KEY', async () => {
    await expect(collect(provider('wrong'))).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
      retryable: false,
    });
  });

  it('throws PROVIDER_NOT_CONFIGURED when its settings resolve to null', async () => {
    const unconfigured = new OpenAICompatibleStreamProvider('ollama', () => null);
    await expect(collect(unconfigured)).rejects.toBeInstanceOf(StreamingError);
    expect(unconfigured.isConfigured()).toBe(false);
  });
});

describe('streaming registrations', () => {
  it('resolves ollama and self-hosted through the streaming resolver once configured', async () => {
    getConfigMock.mockReturnValue({
      ai: {
        ollamaBaseUrl: 'http://gpu.example.com/v1',
        ollamaApiKey: 't',
        selfHostedTextBaseUrl: 'http://vllm.example.com/v1',
        selfHostedTextModel: 'm',
      },
    });
    const resolver = getStreamingResolver();
    expect((await resolver.resolve('ollama')).getName()).toBe('ollama');
    expect((await resolver.resolve('self-hosted')).getName()).toBe('self-hosted');
  });

  it('keeps STREAMING_PROVIDER_IDS and the streaming resolver in lockstep', () => {
    // The documented duplication between models.ts and the resolver's
    // factory keys, pinned so it can never silently drift: every id the
    // catalog claims can stream must actually resolve to a stream adapter.
    const available = new Set(getStreamingResolver().getAvailableProviders());
    for (const id of STREAMING_PROVIDER_IDS_FOR_TESTS) {
      expect(available.has(id), `'${id}' claims streaming but has no adapter`).toBe(true);
    }
  });
});
