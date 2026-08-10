/**
 * A real HTTP server speaking the OpenAI-compatible wire protocol, for tests.
 *
 * WHY A REAL SERVER AND NOT A MOCKED SDK. The property this phase must prove
 * is that Synora can talk to a REMOTE, TOKEN-PROTECTED endpoint — and the
 * load-bearing details live on the wire: the Authorization header actually
 * sent, the SSE framing actually parsed, the `usage` object actually absent
 * (as Ollama commonly omits it). A mocked `OpenAI` class would prove only
 * that we called our own mock. This server stands in for the GPU box, so
 * the same tests that pass against it are expected to pass against the real
 * endpoint with nothing but environment variables changed.
 *
 * Deliberately `node:http` and zero dependencies: a test double with its own
 * dependency tree is a second thing to debug.
 *
 * TEST-SUPPORT ONLY. Imported exclusively from *.test.ts files; never from
 * production code. It binds 127.0.0.1 on an ephemeral port, so nothing can
 * reach it from outside the machine and parallel test files cannot collide.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface MockOpenAIServerOptions {
  /**
   * When set, every endpoint requires `Authorization: Bearer <this value>`
   * and answers 401 otherwise — the same behaviour as the token-checking
   * reverse proxy that must sit in front of a real Ollama deployment.
   */
  requireAuth?: string;
  /** Model ids returned by GET /v1/models. */
  models?: string[];
  /** Body text for non-streaming completions. */
  completionText?: string;
  /** SSE token deltas for streaming completions, one chunk each. */
  streamTokens?: string[];
  /**
   * SSE deltas carrying `reasoning_content` instead of `content` — how
   * DeepSeek-style servers report a model's internal reasoning. Combined
   * with `streamTokens: []` and `finishReason: 'length'` this reproduces
   * the exact reasoning-model failure: real tokens billed, real usage
   * reported, and not one word of answer.
   */
  streamReasoningTokens?: string[];
  /** `finish_reason` on the final chunk / choice. Defaults to `stop`. */
  finishReason?: string;
  /** `reasoning_content` on a non-streaming completion's message. */
  completionReasoning?: string;
  /**
   * Token usage reported by the server. `null` means OMIT the usage object
   * entirely — the Ollama-typical case the spend guard must survive.
   * (For streaming, a usage chunk is only sent when the request asked for
   * it via `stream_options.include_usage`, mirroring the real protocol.)
   */
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
  /** Vector width for POST /v1/embeddings responses. */
  embeddingDimensions?: number;
  /** Force every request to fail with this status. */
  failWith?: { status: number; code?: string };
  /** Artificial delay before responding, for timeout tests. */
  latencyMs?: number;
}

export interface CapturedRequest {
  method: string;
  path: string;
  /** The raw Authorization header — so tests can assert what was ON THE WIRE. */
  authorization: string | undefined;
  body: unknown;
}

export interface MockOpenAIServer {
  /** e.g. `http://127.0.0.1:49152/v1` — pass as a provider's base URL. */
  baseUrl: string;
  /** Every request received, in order. */
  requests: CapturedRequest[];
  /** Change behaviour mid-test (e.g. flip failWith on to simulate an outage). */
  setOptions(patch: Partial<MockOpenAIServerOptions>): void;
  close(): Promise<void>;
}

const DEFAULTS: Required<
  Pick<MockOpenAIServerOptions, 'models' | 'completionText' | 'streamTokens' | 'embeddingDimensions'>
> = {
  models: ['test-model-a', 'test-model-b'],
  completionText: 'Hello from the mock model.',
  streamTokens: ['Hello', ' from', ' the', ' stream.'],
  embeddingDimensions: 8,
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** The OpenAI-style error envelope, so SDK error mapping sees what it expects. */
function apiError(res: ServerResponse, status: number, message: string, code?: string): void {
  json(res, status, {
    error: { message, type: 'invalid_request_error', ...(code ? { code } : {}) },
  });
}

export async function startMockOpenAIServer(
  initial: MockOpenAIServerOptions = {}
): Promise<MockOpenAIServer> {
  let options: MockOpenAIServerOptions = { ...initial };
  const requests: CapturedRequest[] = [];

  const server: Server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    let parsedBody: unknown;
    if (req.method === 'POST') {
      const raw = await readBody(req);
      try {
        parsedBody = raw ? JSON.parse(raw) : undefined;
      } catch {
        parsedBody = raw;
      }
    }
    requests.push({
      method: req.method ?? '',
      path,
      authorization: req.headers.authorization,
      body: parsedBody,
    });

    if (options.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
    }

    // Auth first, exactly as a fronting proxy would: nothing about the
    // request body is examined before the token is.
    if (options.requireAuth !== undefined) {
      if (req.headers.authorization !== `Bearer ${options.requireAuth}`) {
        return apiError(res, 401, 'Invalid API key provided.', 'invalid_api_key');
      }
    }

    if (options.failWith) {
      return apiError(res, options.failWith.status, 'Simulated failure.', options.failWith.code);
    }

    if (req.method === 'GET' && path === '/v1/models') {
      const models = options.models ?? DEFAULTS.models;
      return json(res, 200, {
        object: 'list',
        data: models.map((id) => ({ id, object: 'model' })),
      });
    }

    if (req.method === 'POST' && path === '/v1/chat/completions') {
      const body = (parsedBody ?? {}) as {
        model?: string;
        stream?: boolean;
        stream_options?: { include_usage?: boolean };
      };
      const model = body.model ?? 'unknown-model';
      const usage =
        options.usage === null
          ? undefined
          : (options.usage ?? { prompt_tokens: 7, completion_tokens: 5 });

      if (body.stream === true) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        // Reasoning deltas first, exactly as a reasoning model emits them:
        // the thinking is streamed before any answer, and when the budget
        // runs out mid-thought the answer never arrives at all.
        for (const reasoning of options.streamReasoningTokens ?? []) {
          res.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-mock',
              object: 'chat.completion.chunk',
              model,
              choices: [
                { index: 0, delta: { reasoning_content: reasoning }, finish_reason: null },
              ],
            })}\n\n`
          );
        }
        const tokens = options.streamTokens ?? DEFAULTS.streamTokens;
        for (const token of tokens) {
          res.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-mock',
              object: 'chat.completion.chunk',
              model,
              choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
            })}\n\n`
          );
        }
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion.chunk',
            model,
            choices: [{ index: 0, delta: {}, finish_reason: options.finishReason ?? 'stop' }],
          })}\n\n`
        );
        // Usage arrives as its own final chunk ONLY when the client asked
        // for it AND this server has usage to report — both real-protocol
        // behaviours, and the second is the Ollama-omits-usage case.
        if (usage && body.stream_options?.include_usage) {
          res.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-mock',
              object: 'chat.completion.chunk',
              model,
              choices: [],
              usage,
            })}\n\n`
          );
        }
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      return json(res, 200, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: options.completionText ?? DEFAULTS.completionText,
              ...(options.completionReasoning !== undefined
                ? { reasoning_content: options.completionReasoning }
                : {}),
            },
            finish_reason: options.finishReason ?? 'stop',
          },
        ],
        ...(usage ? { usage } : {}),
      });
    }

    if (req.method === 'POST' && path === '/v1/embeddings') {
      const body = (parsedBody ?? {}) as { input?: string | string[] };
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ''];
      const dims = options.embeddingDimensions ?? DEFAULTS.embeddingDimensions;
      const usage = options.usage === null ? undefined : (options.usage ?? { prompt_tokens: inputs.length * 3 });
      return json(res, 200, {
        object: 'list',
        data: inputs.map((_, index) => ({
          object: 'embedding',
          index,
          embedding: Array.from({ length: dims }, () => 0.1),
        })),
        model: 'mock-embedding-model',
        ...(usage
          ? { usage: { prompt_tokens: usage.prompt_tokens, total_tokens: usage.prompt_tokens } }
          : {}),
      });
    }

    return apiError(res, 404, `No mock handler for ${req.method} ${path}`);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('mock server failed to bind an ephemeral port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    setOptions(patch) {
      options = { ...options, ...patch };
    },
    close() {
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
