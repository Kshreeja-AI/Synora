import { describe, expect, it, vi } from 'vitest';
import { OpenRouterLlmProvider } from './openrouter-llm-provider.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('OpenRouterLlmProvider', () => {
  it('sends the request and maps the chat-completions response', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        model: 'openrouter/auto',
        choices: [{ message: { content: 'Hello there' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );

    const provider = new OpenRouterLlmProvider({ apiKey: 'test-key', fetch: fetchMock });
    const result = await provider.complete({
      model: 'openrouter/auto',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result).toEqual({
      content: 'Hello there',
      model: 'openrouter/auto',
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws an InfrastructureError on a non-ok response', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, false, 500));
    const provider = new OpenRouterLlmProvider({ apiKey: 'test-key', fetch: fetchMock });

    await expect(
      provider.complete({ model: 'openrouter/auto', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('OpenRouter request failed');
  });
});
