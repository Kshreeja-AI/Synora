import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateText } from './index';
import { resolveTextGenerationProvider } from './resolver';

// Mock resolver
vi.mock('./resolver', () => ({
  resolveTextGenerationProvider: vi.fn(),
}));

describe('generateText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves provider and calls generateText', async () => {
    const mockProvider = {
      generateText: vi.fn().mockResolvedValue({
        text: 'Generated text',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 10, outputTokens: 20 },
        finishReason: 'end_turn',
      }),
    };

    (resolveTextGenerationProvider as any).mockResolvedValue(mockProvider);

    const result = await generateText({
      prompt: 'Test prompt',
    });

    expect(result.text).toBe('Generated text');
    expect(result.provider).toBe('anthropic');
    expect(mockProvider.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Test prompt',
      })
    );
  });

  it('passes through request parameters to provider', async () => {
    const mockProvider = {
      generateText: vi.fn().mockResolvedValue({
        text: 'Result',
        provider: 'openai',
        model: 'gpt-4o',
        usage: { inputTokens: 5, outputTokens: 10 },
        finishReason: 'stop',
      }),
    };

    (resolveTextGenerationProvider as any).mockResolvedValue(mockProvider);

    await generateText({
      prompt: 'Write code',
      mode: 'code',
      model: 'gpt-4o-mini',
      maxTokens: 2048,
      temperature: 0.5,
      systemPrompt: 'You are a code expert',
    });

    expect(mockProvider.generateText).toHaveBeenCalledWith({
      prompt: 'Write code',
      mode: 'code-generation',
      model: 'gpt-4o-mini',
      maxTokens: 2048,
      temperature: 0.5,
      systemPrompt: 'You are a code expert',
    });
  });

  it('returns provider response directly', async () => {
    const mockResponse = {
      text: 'Test response',
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      usage: { inputTokens: 100, outputTokens: 50 },
      finishReason: 'STOP',
    };

    const mockProvider = {
      generateText: vi.fn().mockResolvedValue(mockResponse),
    };

    (resolveTextGenerationProvider as any).mockResolvedValue(mockProvider);

    const result = await generateText({ prompt: 'Test' });

    expect(result).toEqual(mockResponse);
  });

  it('throws error when provider resolution fails', async () => {
    (resolveTextGenerationProvider as any).mockRejectedValue(
      new Error('No provider configured')
    );

    await expect(generateText({ prompt: 'Test' })).rejects.toThrow(
      'No provider configured'
    );
  });

  it('throws error when provider generateText fails', async () => {
    const mockProvider = {
      generateText: vi.fn().mockRejectedValue(
        new Error('API rate limit exceeded')
      ),
    };

    (resolveTextGenerationProvider as any).mockResolvedValue(mockProvider);

    await expect(generateText({ prompt: 'Test' })).rejects.toThrow(
      'API rate limit exceeded'
    );
  });
});
