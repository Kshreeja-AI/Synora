import { describe, it, expect } from 'vitest';
import { resolveSystemPrompt, DEFAULT_MAX_TOKENS } from './shared';
import { TextGenerationMode } from './types';

describe('resolveSystemPrompt', () => {
  it('returns undefined when no mode and no systemPrompt provided', () => {
    const result = resolveSystemPrompt({
      prompt: 'test',
    });
    expect(result).toBeUndefined();
  });

  it('returns custom systemPrompt when provided', () => {
    const custom = 'You are a helpful assistant.';
    const result = resolveSystemPrompt({
      prompt: 'test',
      systemPrompt: custom,
    });
    expect(result).toBe(custom);
  });

  it('returns code mode system prompt when mode is code', () => {
    const result = resolveSystemPrompt({
      prompt: 'write a function',
      mode: 'code' as TextGenerationMode,
    });
    expect(result).toBeDefined();
    expect(result).toContain('code');
  });

  it('returns text mode system prompt when mode is text', () => {
    const result = resolveSystemPrompt({
      prompt: 'write a story',
      mode: 'text' as TextGenerationMode,
    });
    expect(result).toBeDefined();
  });

  it('prioritizes custom systemPrompt over mode default', () => {
    const custom = 'Custom prompt';
    const result = resolveSystemPrompt({
      prompt: 'test',
      mode: 'code' as TextGenerationMode,
      systemPrompt: custom,
    });
    expect(result).toBe(custom);
  });

  it('handles undefined mode gracefully', () => {
    const result = resolveSystemPrompt({
      prompt: 'test',
      mode: undefined,
    });
    expect(result).toBeUndefined();
  });
});

describe('DEFAULT_MAX_TOKENS', () => {
  it('is a positive number', () => {
    expect(typeof DEFAULT_MAX_TOKENS).toBe('number');
    expect(DEFAULT_MAX_TOKENS).toBeGreaterThan(0);
  });

  it('is reasonable for text generation (between 1000 and 100000)', () => {
    expect(DEFAULT_MAX_TOKENS).toBeGreaterThanOrEqual(1000);
    expect(DEFAULT_MAX_TOKENS).toBeLessThanOrEqual(100000);
  });
});
