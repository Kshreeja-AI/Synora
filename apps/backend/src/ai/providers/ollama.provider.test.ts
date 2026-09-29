/**
 * Ollama provider tests.
 *
 * WHY THIS PROVIDER GETS ITS OWN TEST FILE. Ollama is the only text
 * provider Synora can run with no API key, no billing relationship, and no
 * cloud account. That makes it the single credential-free path to
 * measuring the AI quality launch gates — every other provider leaves
 * those gates unmeasurable until someone pays for a key. A provider
 * carrying that much weight should not be the one with no tests, which is
 * exactly what the 2026-08-04 feature inventory found it to be.
 *
 * The property under test is the deliberate refusal to guess: Ollama must
 * activate only when explicitly pointed at a base URL, never by assuming
 * something is listening on the conventional local port.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));

vi.mock('../../config', () => ({ getConfig: getConfigMock }));
vi.mock('openai', () => ({
  default: class {
    apiKey: string;
    baseURL: string;
    constructor(opts: { apiKey: string; baseURL: string }) {
      this.apiKey = opts.apiKey;
      this.baseURL = opts.baseURL;
    }
  },
}));

import { ollamaDescriptor } from './ollama.provider';
import { OpenAICompatibleTextProvider } from './openaiCompatible.provider';

function config(ai: { ollamaBaseUrl?: string; ollamaModel?: string; ollamaApiKey?: string }): void {
  getConfigMock.mockReturnValue({ ai: { ollamaModel: 'llama3.1', ...ai } });
}

describe('ollama endpoint authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the configured token — a protected remote endpoint is usable', async () => {
    config({ ollamaBaseUrl: 'https://gpu.example.com/v1', ollamaApiKey: 'proxy-token' });
    const provider = (await ollamaDescriptor.create()) as OpenAICompatibleTextProvider & {
      client?: unknown;
    };
    // The mocked OpenAI class records its constructor options; the token
    // must be the apiKey, which the SDK sends as a Bearer header.
    const client = (provider as unknown as { client: { apiKey: string; baseURL: string } }).client;
    expect(client.apiKey).toBe('proxy-token');
    expect(client.baseURL).toBe('https://gpu.example.com/v1');
  });

  it('keeps the ignored placeholder when no token is configured — bare local Ollama', async () => {
    config({ ollamaBaseUrl: 'http://localhost:11434/v1' });
    const provider = await ollamaDescriptor.create();
    const client = (provider as unknown as { client: { apiKey: string } }).client;
    expect(client.apiKey).toBe('ollama-does-not-require-an-api-key');
  });

  it('exposes verifyCredential so a wrong token is caught at readiness, not on a user message', () => {
    expect(typeof ollamaDescriptor.verifyCredential).toBe('function');
  });
});

describe('ollama provider descriptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the text and code capabilities it can serve', () => {
    expect(ollamaDescriptor.id).toBe('ollama');
    expect(ollamaDescriptor.displayName).toBe('Ollama');
    expect(ollamaDescriptor.capabilities).toContain('text-generation');
    expect(ollamaDescriptor.capabilities).toContain('code-generation');
  });

  describe('activation', () => {
    it('is not configured until a base URL is set explicitly', async () => {
      config({ ollamaBaseUrl: undefined });

      // No silent default to localhost:11434. "Ollama is running
      // somewhere" is not a fact this application may assume — a default
      // could make auto-selection pick up a developer's laptop daemon in
      // an environment nobody intended it for.
      await expect(ollamaDescriptor.isConfigured()).resolves.toBe(false);
    });

    it('is configured once a base URL is set', async () => {
      config({ ollamaBaseUrl: 'http://localhost:11434/v1' });
      await expect(ollamaDescriptor.isConfigured()).resolves.toBe(true);
    });

    it('treats an empty base URL as unconfigured, not as a valid host', async () => {
      config({ ollamaBaseUrl: '' });
      await expect(ollamaDescriptor.isConfigured()).resolves.toBe(false);
    });
  });

  describe('creation', () => {
    it('builds an OpenAI-compatible provider pointed at the configured host', async () => {
      config({ ollamaBaseUrl: 'http://ollama.internal:11434/v1', ollamaModel: 'llama3.1' });

      const provider = await ollamaDescriptor.create();

      // Reusing the compatible adapter is the whole point: Ollama speaks
      // the same wire format, so it needs no parallel implementation.
      expect(provider).toBeInstanceOf(OpenAICompatibleTextProvider);
      expect(provider.id).toBe('ollama');
    });

    it('sends the configured model on a request that does not name one', async () => {
      config({ ollamaBaseUrl: 'http://localhost:11434/v1', ollamaModel: 'qwen2.5-coder' });
      const create = vi.fn().mockResolvedValue({
        model: 'qwen2.5-coder',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      const provider = await ollamaDescriptor.create();
      // Asserted through behaviour rather than by reaching for a private
      // field: what matters is the model that reaches the daemon, and a
      // hardcoded default would silently evaluate a different model than
      // OLLAMA_MODEL names.
      (provider as unknown as { client: { chat: { completions: { create: typeof create } } } }).client = {
        chat: { completions: { create } },
      };

      await provider.generateText({ prompt: 'hello' });

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen2.5-coder' }));
    });

    it('lets an explicit per-request model override the configured default', async () => {
      config({ ollamaBaseUrl: 'http://localhost:11434/v1', ollamaModel: 'qwen2.5-coder' });
      const create = vi.fn().mockResolvedValue({
        model: 'llama3.1',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      const provider = await ollamaDescriptor.create();
      (provider as unknown as { client: { chat: { completions: { create: typeof create } } } }).client = {
        chat: { completions: { create } },
      };

      await provider.generateText({ prompt: 'hello', model: 'llama3.1' });

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'llama3.1' }));
    });

    it('refuses to create without a base URL instead of falling back', async () => {
      config({ ollamaBaseUrl: undefined });

      // Failing loudly beats quietly connecting somewhere unintended.
      await expect(ollamaDescriptor.create()).rejects.toThrow(/OLLAMA_BASE_URL/);
    });
  });
});
