import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleTextProvider } from './openaiCompatible.provider';
import { discoverOpenRouterModelAvailability } from './openrouter.provider';
import { OpenRouterTextToSpeechProvider } from './openrouterTextToSpeech.provider';

describe('OpenRouter model routing', () => {
  it('passes the selected catalog model id through the shared chat adapter unchanged', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'qwen/qwen3.8-27b:free',
      choices: [{ message: { content: 'Routed response' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    });
    const provider = new OpenAICompatibleTextProvider(
      'openrouter',
      { chat: { completions: { create } } } as never,
      'anthropic/claude-sonnet-5'
    );

    const result = await provider.generateText({
      prompt: 'Hello',
      model: 'qwen/qwen3.8-27b:free',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen/qwen3.8-27b:free' }));
    expect(result).toMatchObject({ provider: 'openrouter', model: 'qwen/qwen3.8-27b:free' });
  });

  it('checks chat, embeddings, images, speech and decisions through their discovery endpoints', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const idsByPath: Record<string, string[]> = {
        '/models': ['qwen/qwen3.8-27b:free'],
        '/embeddings/models': ['nvidia/nemotron-3-embed-1b:free'],
        '/images/models': ['inclusionai/ming-image-0.1-design-layer'],
        '/models?output_modalities=speech': ['fish-audio/s2.1-pro-free:free'],
      };
      // Longest match first: "/embeddings/models" also ends with "/models".
      const path = Object.keys(idsByPath)
        .sort((a, b) => b.length - a.length)
        .find((candidate) => url.endsWith(candidate));
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: (path ? idsByPath[path] : []).map((id) => ({ id })) }),
      } as Response;
    });
    const models = [
      { id: 'qwen/qwen3.8-27b:free', roles: ['text-generation'] as const },
      { id: 'qwen/not-current:free', roles: ['text-generation'] as const },
      { id: 'nvidia/nemotron-3-embed-1b:free', roles: ['embeddings'] as const },
      { id: 'inclusionai/ming-image-0.1-design-layer', roles: ['image-generation'] as const },
      { id: 'fish-audio/s2.1-pro-free:free', roles: ['text-to-speech'] as const },
      { id: 'inception/mercury-decide:free', roles: ['decision'] as const },
    ];

    const availability = await discoverOpenRouterModelAvailability(models, fetcher as typeof fetch);

    expect(availability.get('qwen/qwen3.8-27b:free')).toBe('available');
    expect(availability.get('qwen/not-current:free')).toBe('unavailable');
    expect(availability.get('nvidia/nemotron-3-embed-1b:free')).toBe('available');
    expect(availability.get('inclusionai/ming-image-0.1-design-layer')).toBe('available');
    expect(availability.get('fish-audio/s2.1-pro-free:free')).toBe('available');
    expect(availability.get('inception/mercury-decide:free')).toBe('available');
  });

  it('reports unknown availability when discovery cannot reach OpenRouter', async () => {
    const availability = await discoverOpenRouterModelAvailability(
      [{ id: 'nvidia/nemotron-3-embed-1b:free', roles: ['embeddings'] }],
      vi.fn().mockRejectedValue(new Error('network unavailable')) as typeof fetch
    );
    expect(availability.get('nvidia/nemotron-3-embed-1b:free')).toBe('unknown');
  });

  it('routes TTS models through the speech endpoint and requires a real voice', async () => {
    const create = vi.fn().mockResolvedValue({ arrayBuffer: async () => Uint8Array.of(1, 2, 3) });
    const provider = new OpenRouterTextToSpeechProvider(
      'openrouter',
      { audio: { speech: { create } } } as never,
      'fish-audio/s2.1-pro-free:free'
    );

    await expect(provider.synthesize({ text: 'Hello' })).rejects.toThrow(/requires an explicit voice/);
    expect(create).not.toHaveBeenCalled();

    const result = await provider.synthesize({ text: 'Hello', voice: 'fish-voice' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'fish-audio/s2.1-pro-free:free',
      input: 'Hello',
      voice: 'fish-voice',
      response_format: 'mp3',
    }));
    expect(result.audio).toEqual(Buffer.from([1, 2, 3]));
  });
});
