/**
 * AN EMPTY ANSWER IS NOT AN ANSWER.
 *
 * A model can finish successfully — HTTP 200, no error, real tokens
 * billed — and return nothing at all. Every adapter used to pass that
 * straight on as `text: ''`, and every layer above read it as a normal
 * reply: the chat worker persisted a blank assistant message and marked
 * the job COMPLETED. The person saw an empty bubble, having just paid for
 * the tokens, with no reason given in the product or in the logs.
 *
 * The commonest cause is a reasoning model spending its whole output
 * budget thinking before writing a word of answer — a configuration
 * problem with a one-line fix, invisible unless something says so.
 *
 * These tests run against the real OpenAI-compatible wire (a local HTTP
 * server speaking SSE), not a mocked SDK, because the failure lives in the
 * response shape: `finish_reason: 'length'`, reasoning deltas, and no
 * content. Mocking the SDK would only prove we can call our own mock.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import OpenAI from 'openai';

import { classifyEmptyGeneration, emptyGenerationMessage } from '../shared';
import { OpenAICompatibleTextProvider } from '../providers/openaiCompatible.provider';
import { OpenAICompatibleStreamProvider } from '../streaming/providers/openaiCompatible';
import { AIProviderError } from '../types';
import { StreamChunkType, StreamingError } from '../streaming/types';
import {
  startMockOpenAIServer,
  type MockOpenAIServer,
} from '../../test-support/mockOpenAIServer';

describe('classifying why a generation came back empty', () => {
  it('reads the output budget running out from either provider spelling', () => {
    // OpenAI-compatible says `length`; Anthropic says `max_tokens`. Same
    // event, and the person needs the same instruction either way.
    expect(classifyEmptyGeneration('length')).toBe('output-budget-exhausted');
    expect(classifyEmptyGeneration('max_tokens')).toBe('output-budget-exhausted');
    expect(classifyEmptyGeneration('MAX_TOKENS')).toBe('output-budget-exhausted');
  });

  it('keeps a safety filter distinct from an exhausted budget', () => {
    // Telling someone to raise their token limit when the provider refused
    // on safety grounds sends them to change the one setting that cannot
    // help.
    expect(classifyEmptyGeneration('content_filter')).toBe('content-filtered');
    expect(classifyEmptyGeneration('SAFETY')).toBe('content-filtered');
  });

  it('admits it does not know rather than guessing', () => {
    expect(classifyEmptyGeneration('stop')).toBe('no-output');
    expect(classifyEmptyGeneration(undefined)).toBe('no-output');
    expect(classifyEmptyGeneration('some-router-specific-reason')).toBe('no-output');
  });

  it('tells the person what to change, not just what broke', () => {
    const message = emptyGenerationMessage('ollama', 'output-budget-exhausted');
    expect(message).toMatch(/raise the response length limit/i);
    expect(message).toMatch(/reasons less/i);
  });

  it('says so plainly when the whole budget went on reasoning', () => {
    const vague = emptyGenerationMessage('ollama', 'output-budget-exhausted');
    const certain = emptyGenerationMessage('ollama', 'output-budget-exhausted', {
      reasonedWithoutAnswering: true,
    });
    expect(vague).toMatch(/usually means/i);
    expect(certain).toMatch(/whole budget went on internal reasoning/i);
    expect(certain).not.toMatch(/usually means/i);
  });

  it('names no model and prescribes no control token', () => {
    // Provider-agnostic by construction. Naming a model family, or telling
    // the caller to inject something like a no-think directive, would bake
    // one vendor's behaviour into a layer that must serve all of them —
    // and would be wrong the moment the deployment changed models.
    // A neutral provider id, because the id itself is legitimately echoed
    // back and several real ones contain a model family's name.
    const all = (['output-budget-exhausted', 'content-filtered', 'no-output'] as const).map((c) =>
      emptyGenerationMessage('the-endpoint', c)
    );
    for (const message of all) {
      expect(message).not.toMatch(/\b(deepseek|qwen|llama|gpt|claude|gemini)\b/i);
      expect(message).not.toMatch(/no_think|\/think/i);
    }
  });
});

describe('non-streaming: a 200 with no text is refused', () => {
  let server: MockOpenAIServer;

  beforeAll(async () => {
    server = await startMockOpenAIServer({});
  });

  afterAll(async () => {
    await server.close();
  });

  function provider(): OpenAICompatibleTextProvider {
    return new OpenAICompatibleTextProvider(
      'self-hosted',
      new OpenAI({ apiKey: 'not-required', baseURL: server.baseUrl }),
      'test-model-a'
    );
  }

  it('refuses an empty body and names the exhausted budget', async () => {
    server.setOptions({ completionText: '', finishReason: 'length' });

    await expect(provider().generateText({ prompt: 'hello' })).rejects.toThrow(
      /used its entire output budget/i
    );
  });

  it('is certain about the cause when the server reported reasoning', async () => {
    server.setOptions({
      completionText: '',
      finishReason: 'length',
      completionReasoning: 'Let me think about this at considerable length...',
    });

    await expect(provider().generateText({ prompt: 'hello' })).rejects.toThrow(
      /whole budget went on internal reasoning/i
    );
  });

  it('refuses whitespace too — a reply of spaces is still no reply', async () => {
    server.setOptions({ completionText: '   \n  ', finishReason: 'stop', completionReasoning: undefined });

    await expect(provider().generateText({ prompt: 'hello' })).rejects.toBeInstanceOf(
      AIProviderError
    );
  });

  it('still returns a real answer untouched', async () => {
    // The other half of the property: a working generation must be
    // completely unaffected. A guard that also blocked good replies would
    // be a worse bug than the one it fixes.
    server.setOptions({ completionText: 'A real answer.', finishReason: 'stop' });

    const result = await provider().generateText({ prompt: 'hello' });
    expect(result.text).toBe('A real answer.');
  });
});

describe('streaming: a stream that said nothing is refused', () => {
  let server: MockOpenAIServer;

  beforeAll(async () => {
    server = await startMockOpenAIServer({});
  });

  afterAll(async () => {
    await server.close();
  });

  function provider(): OpenAICompatibleStreamProvider {
    return new OpenAICompatibleStreamProvider('self-hosted', () => ({
      baseURL: server.baseUrl,
    }));
  }

  async function collect(
    input: Partial<{ abortSignal: AbortSignal }> = {}
  ): Promise<{ type: StreamChunkType }[]> {
    const chunks: { type: StreamChunkType }[] = [];
    for await (const chunk of provider().generateStream({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'test-model-a',
      ...input,
    })) {
      chunks.push(chunk);
    }
    return chunks;
  }

  it('THE REPORTED FAILURE: reasoning consumed the budget, no answer arrived', async () => {
    // The exact wire a reasoning model produces when its output budget runs
    // out mid-thought: reasoning deltas, zero content deltas, real usage,
    // `finish_reason: 'length'`. Before this, the worker saved a blank
    // assistant message and called the job COMPLETED.
    server.setOptions({
      streamTokens: [],
      streamReasoningTokens: ['Let me', ' work', ' through', ' this'],
      finishReason: 'length',
      usage: { prompt_tokens: 40, completion_tokens: 2048 },
    });

    await expect(collect()).rejects.toMatchObject({
      name: 'StreamingError',
      code: 'EMPTY_RESPONSE',
      // Retrying spends the same budget for the same empty result.
      retryable: false,
    });
    await expect(collect()).rejects.toThrow(/whole budget went on internal reasoning/i);
  });

  it('refuses an empty stream even with no reasoning reported', async () => {
    // Not every OpenAI-compatible server reports reasoning. The refusal
    // must not depend on that extension being present — only the wording
    // gets less specific.
    server.setOptions({
      streamTokens: [],
      streamReasoningTokens: [],
      finishReason: 'stop',
      usage: { prompt_tokens: 40, completion_tokens: 0 },
    });

    await expect(collect()).rejects.toBeInstanceOf(StreamingError);
    await expect(collect()).rejects.toThrow(/no answer/i);
  });

  it('does NOT refuse a stream the person cancelled', async () => {
    // Cancellation is a decision, not a failure. Raising an error here
    // would turn "I changed my mind" into a red banner.
    const controller = new AbortController();
    controller.abort();
    server.setOptions({ streamTokens: [], streamReasoningTokens: [], finishReason: 'stop' });

    await expect(collect({ abortSignal: controller.signal })).resolves.toBeDefined();
  });

  it('leaves a normal stream completely alone', async () => {
    server.setOptions({
      streamTokens: ['A', 'B'],
      streamReasoningTokens: [],
      finishReason: 'stop',
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    });

    const chunks = await collect();
    expect(chunks.filter((c) => c.type === StreamChunkType.TOKEN)).toHaveLength(2);
    expect(chunks[chunks.length - 1].type).toBe(StreamChunkType.USAGE);
  });

  it('answers first then runs out — the partial reply is kept, not thrown away', async () => {
    // `finish_reason: 'length'` with content already streamed is a
    // TRUNCATED answer, and a truncated answer is worth far more than an
    // error. Only a completely empty response is refused.
    server.setOptions({
      streamTokens: ['Half an ans'],
      streamReasoningTokens: [],
      finishReason: 'length',
      usage: { prompt_tokens: 4, completion_tokens: 2048 },
    });

    const chunks = await collect();
    expect(chunks.filter((c) => c.type === StreamChunkType.TOKEN)).toHaveLength(1);
  });
});

/**
 * Anthropic reaches the same failure by a different route: thinking blocks
 * consume the output budget, `stop_reason` comes back `max_tokens`, and the
 * text blocks the adapter filters for are simply absent. The SDK is mocked
 * here rather than served over a wire — Anthropic's protocol is not the
 * OpenAI one the local mock server speaks, and standing up a second wire
 * double would test the double, not the adapter.
 */
describe('Anthropic: thinking-only responses are refused too', () => {
  async function generateWith(response: unknown): Promise<unknown> {
    const { AnthropicTextProvider } = await import('../providers/anthropic.provider');
    const client = {
      messages: { create: async () => response },
    } as unknown as ConstructorParameters<typeof AnthropicTextProvider>[0];
    return new AnthropicTextProvider(client, 'claude-sonnet-5').generateText({ prompt: 'hi' });
  }

  it('refuses when only thinking blocks came back and the budget ran out', async () => {
    await expect(
      generateWith({
        content: [{ type: 'thinking', thinking: 'at length...' }],
        model: 'claude-sonnet-5',
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 4096 },
      })
    ).rejects.toThrow(/used its entire output budget/i);
  });

  it('does not bury the reason inside a generic failure wrapper', async () => {
    // The catch block used to re-wrap every error as "Anthropic text
    // generation failed: ...", which reads like a provider outage and sends
    // the reader to a status page instead of to the setting they can change.
    await expect(
      generateWith({
        content: [],
        model: 'claude-sonnet-5',
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 4096 },
      })
    ).rejects.toThrow(/^(?!.*text generation failed)/s);
  });

  it('allows an empty answer that came with tool calls', async () => {
    // The model chose to act rather than speak. That is a complete,
    // correct response and must not be refused.
    const result = (await generateWith({
      content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'x' } }],
      model: 'claude-sonnet-5',
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 20 },
    })) as { text: string; toolCalls?: unknown[] };

    expect(result.text).toBe('');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('still returns ordinary text untouched', async () => {
    const result = (await generateWith({
      content: [{ type: 'text', text: 'A real answer.' }],
      model: 'claude-sonnet-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 },
    })) as { text: string };

    expect(result.text).toBe('A real answer.');
  });
});
