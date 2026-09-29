/**
 * Self-test for the mock OpenAI-compatible server.
 *
 * A test double the whole phase leans on must itself be proven, or every
 * downstream "pass" inherits an unexamined assumption. These tests speak
 * raw HTTP — no SDK — so what is pinned is the wire behaviour.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startMockOpenAIServer, type MockOpenAIServer } from './mockOpenAIServer';

async function post(server: MockOpenAIServer, path: string, body: unknown, token?: string) {
  return fetch(`${server.baseUrl.replace(/\/v1$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('mockOpenAIServer', () => {
  let server: MockOpenAIServer;

  beforeAll(async () => {
    server = await startMockOpenAIServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('lists models', async () => {
    const res = await fetch(`${server.baseUrl}/models`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((m) => m.id)).toEqual(['test-model-a', 'test-model-b']);
  });

  it('serves a completion with usage by default', async () => {
    const res = await post(server, '/v1/chat/completions', { model: 'test-model-a' });
    const body = (await res.json()) as {
      model: string;
      choices: { message: { content: string } }[];
      usage?: unknown;
    };
    expect(body.model).toBe('test-model-a');
    expect(body.choices[0].message.content).toContain('mock model');
    expect(body.usage).toBeDefined();
  });

  it('OMITS usage entirely when configured with usage: null — the Ollama case', async () => {
    // Load-bearing for the spend guard: "no usage reported" must arrive as
    // an ABSENT object, never as zeros, or unknown becomes indistinguishable
    // from free.
    server.setOptions({ usage: null });
    const res = await post(server, '/v1/chat/completions', { model: 'm' });
    const body = (await res.json()) as Record<string, unknown>;
    expect('usage' in body).toBe(false);
    server.setOptions({ usage: undefined });
  });

  it('streams SSE chunks in order and terminates with [DONE]', async () => {
    const res = await post(server, '/v1/chat/completions', { model: 'm', stream: true });
    const text = await res.text();
    const dataLines = text.split('\n').filter((line) => line.startsWith('data: '));
    // 4 token chunks + 1 finish chunk + [DONE]; no usage chunk because the
    // request did not ask for one.
    expect(dataLines).toHaveLength(6);
    expect(dataLines[dataLines.length - 1]).toBe('data: [DONE]');
    const first = JSON.parse(dataLines[0].slice(6)) as {
      choices: { delta: { content?: string } }[];
    };
    expect(first.choices[0].delta.content).toBe('Hello');
    expect(text).not.toContain('"usage"');
  });

  it('sends a usage chunk only when stream_options.include_usage was requested', async () => {
    const res = await post(server, '/v1/chat/completions', {
      model: 'm',
      stream: true,
      stream_options: { include_usage: true },
    });
    const text = await res.text();
    expect(text).toContain('"usage"');
  });

  it('answers embeddings with one vector per input', async () => {
    const res = await post(server, '/v1/embeddings', { input: ['a', 'b', 'c'] });
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    expect(body.data).toHaveLength(3);
    expect(body.data[0].embedding).toHaveLength(8);
  });

  describe('auth mode', () => {
    let authed: MockOpenAIServer;

    beforeAll(async () => {
      authed = await startMockOpenAIServer({ requireAuth: 'secret-token' });
    });

    afterAll(async () => {
      await authed.close();
    });

    it('rejects a missing or wrong token with 401 before reading anything else', async () => {
      const missing = await fetch(`${authed.baseUrl}/models`);
      expect(missing.status).toBe(401);
      const wrong = await post(authed, '/v1/chat/completions', { model: 'm' }, 'wrong');
      expect(wrong.status).toBe(401);
      const body = (await wrong.json()) as { error: { code: string } };
      expect(body.error.code).toBe('invalid_api_key');
    });

    it('accepts the right token and records the header AS SENT on the wire', async () => {
      const res = await post(authed, '/v1/chat/completions', { model: 'm' }, 'secret-token');
      expect(res.status).toBe(200);
      // The captured request is the evidence downstream tests rely on: what
      // the client put on the wire, not what a mock said it would send.
      const last = authed.requests[authed.requests.length - 1];
      expect(last.authorization).toBe('Bearer secret-token');
      expect(last.path).toBe('/v1/chat/completions');
    });
  });

  it('simulates outages via failWith', async () => {
    const failing = await startMockOpenAIServer({ failWith: { status: 503 } });
    const res = await fetch(`${failing.baseUrl}/models`);
    expect(res.status).toBe(503);
    await failing.close();
  });
});
