import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicTextProvider, anthropicDescriptor } from './anthropic.provider';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk');

describe('AnthropicTextProvider', () => {
  let provider: AnthropicTextProvider;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Test response' }],
          model: 'claude-sonnet-5',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      },
    };

    provider = new AnthropicTextProvider(mockClient, 'claude-sonnet-5');
  });

  it('has correct id', () => {
    expect(provider.id).toBe('anthropic');
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
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-5');
    expect(result.usage!.inputTokens).toBe(10);
    expect(result.usage!.outputTokens).toBe(20);
    expect(result.finishReason).toBe('end_turn');
  });

  it('uses custom model when provided', async () => {
    await provider.generateText({
      prompt: 'Test',
      model: 'claude-opus-4',
    });

    expect(mockClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4',
      })
    );
  });

  it('uses default model when not provided', async () => {
    await provider.generateText({
      prompt: 'Test',
    });

    expect(mockClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-5',
      })
    );
  });

  it('includes system prompt when provided', async () => {
    await provider.generateText({
      prompt: 'Test',
      systemPrompt: 'You are helpful',
    });

    expect(mockClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are helpful',
      })
    );
  });

  it('uses default max tokens when not provided', async () => {
    await provider.generateText({
      prompt: 'Test',
    });

    expect(mockClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: expect.any(Number),
      })
    );
  });

  it('uses custom max tokens when provided', async () => {
    await provider.generateText({
      prompt: 'Test',
      maxTokens: 2048,
    });

    expect(mockClient.messages.create).toHaveBeenCalledWith(
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

    expect(mockClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.7,
      })
    );
  });

  it('throws AIProviderError on SDK error', async () => {
    mockClient.messages.create = vi.fn().mockRejectedValueOnce(
      new Error('API rate limit exceeded')
    );

    await expect(
      provider.generateText({ prompt: 'Test' })
    ).rejects.toThrow('Anthropic text generation failed');
  });
});

describe('anthropicDescriptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct id', () => {
    expect(anthropicDescriptor.id).toBe('anthropic');
  });

  it('has correct displayName', () => {
    expect(anthropicDescriptor.displayName).toBe('Anthropic Claude');
  });

  it('supports text-generation capability', () => {
    expect(anthropicDescriptor.capabilities).toContain('text-generation');
  });

  it('supports code-generation capability', () => {
    expect(anthropicDescriptor.capabilities).toContain('code-generation');
  });

  it('has isConfigured method', () => {
    expect(typeof anthropicDescriptor.isConfigured).toBe('function');
  });

  it('has create method', () => {
    expect(typeof anthropicDescriptor.create).toBe('function');
  });
});
