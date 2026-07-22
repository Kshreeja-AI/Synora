import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAICompatibleTextProvider } from './openaiCompatible.provider';

// Mock OpenAI SDK
vi.mock('openai');

describe('OpenAICompatibleTextProvider', () => {
  let provider: OpenAICompatibleTextProvider;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'Test response',
                },
                finish_reason: 'stop',
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          }),
        },
      },
    };

    provider = new OpenAICompatibleTextProvider('openai', mockClient, 'gpt-4o');
  });

  it('has correct id', () => {
    expect(provider.id).toBe('openai');
  });

  it('supports text-generation capability', () => {
    expect(provider.capabilities).toContain('text-generation');
  });

  it('supports code-generation capability', () => {
    expect(provider.capabilities).toContain('code-generation');
  });

  it('generates text successfully', async () => {
    const result = await provider.generateText({
      prompt: 'Hello, world!',
    });

    expect(result.text).toBe('Test response');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
    expect(result.usage!.inputTokens).toBe(10);
    expect(result.usage!.outputTokens).toBe(20);
    expect(result.finishReason).toBe('stop');
  });

  it('uses custom model when provided', async () => {
    await provider.generateText({
      prompt: 'Test',
      model: 'gpt-4o-mini',
    });

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
      })
    );
  });

  it('uses default model when not provided', async () => {
    await provider.generateText({
      prompt: 'Test',
    });

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
      })
    );
  });

  it('includes system prompt as separate message', async () => {
    await provider.generateText({
      prompt: 'Test',
      systemPrompt: 'You are helpful',
    });

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system', content: 'You are helpful' }),
          expect.objectContaining({ role: 'user', content: 'Test' }),
        ]),
      })
    );
  });

  it('omits system message when no system prompt', async () => {
    await provider.generateText({
      prompt: 'Test',
    });

    const call = mockClient.chat.completions.create.mock.calls[0][0];
    const messages = (call as any).messages;
    const systemMessages = messages.filter((m: any) => m.role === 'system');
    expect(systemMessages.length).toBe(0);
  });

  it('uses custom max tokens when provided', async () => {
    await provider.generateText({
      prompt: 'Test',
      maxTokens: 2048,
    });

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 2048,
      })
    );
  });

  it('handles temperature parameter', async () => {
    await provider.generateText({
      prompt: 'Test',
      temperature: 0.7,
    });

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.7,
      })
    );
  });

  it('throws AIProviderError on SDK error', async () => {
    mockClient.chat.completions.create = vi.fn().mockRejectedValueOnce(
      new Error('API error')
    );

    await expect(
      provider.generateText({ prompt: 'Test' })
    ).rejects.toThrow('OpenAI-compatible text generation failed');
  });

  it('handles missing usage data gracefully', async () => {
    mockClient.chat.completions.create = vi.fn().mockResolvedValueOnce({
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Response',
          },
          finish_reason: 'stop',
        },
      ],
      usage: undefined,
    } as any);

    const result = await provider.generateText({ prompt: 'Test' });

    expect(result.text).toBe('Response');
    expect(result.usage!.inputTokens).toBeUndefined();
    expect(result.usage!.outputTokens).toBeUndefined();
  });
});
