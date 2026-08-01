import { describe, it, expect } from 'vitest';
import {
  validateWorkspaceId,
  validateText,
  validateBatch,
  redactTextForLogging,
} from '../security';
import { EmbeddingValidationError } from '../types';

const limits = { maxInputChars: 20, maxBatchRequestSize: 3 };

describe('validateWorkspaceId', () => {
  it('accepts a non-empty workspaceId', () => {
    expect(() => validateWorkspaceId('ws-1')).not.toThrow();
  });

  it('rejects an empty workspaceId', () => {
    expect(() => validateWorkspaceId('')).toThrow(EmbeddingValidationError);
  });

  it('rejects a whitespace-only workspaceId', () => {
    expect(() => validateWorkspaceId('   ')).toThrow(EmbeddingValidationError);
  });
});

describe('validateText', () => {
  it('accepts text within the limit', () => {
    expect(() => validateText('short text', limits)).not.toThrow();
  });

  it('rejects empty text', () => {
    expect(() => validateText('', limits)).toThrow(EmbeddingValidationError);
  });

  it('rejects text exceeding maxInputChars', () => {
    expect(() => validateText('a'.repeat(21), limits)).toThrow(/exceeds the maximum/);
  });
});

describe('validateBatch', () => {
  it('accepts a batch within limits', () => {
    expect(() => validateBatch(['a', 'b'], limits)).not.toThrow();
  });

  it('rejects an empty batch', () => {
    expect(() => validateBatch([], limits)).toThrow(EmbeddingValidationError);
  });

  it('rejects a batch exceeding maxBatchRequestSize', () => {
    expect(() => validateBatch(['a', 'b', 'c', 'd'], limits)).toThrow(/exceeds the maximum/);
  });

  it('rejects a batch containing an over-length text', () => {
    expect(() => validateBatch(['ok', 'a'.repeat(21)], limits)).toThrow(/exceeds the maximum/);
  });
});

describe('redactTextForLogging', () => {
  it('never includes the full text for long input', () => {
    const longText = 'sensitive user document content '.repeat(10);
    const preview = redactTextForLogging(longText);
    expect(preview.length).toBeLessThan(longText.length);
    expect(preview).toContain('…');
  });

  it('includes the character count', () => {
    const preview = redactTextForLogging('hello world');
    expect(preview).toContain('(11 chars)');
  });

  it('does not truncate short text', () => {
    const preview = redactTextForLogging('short');
    expect(preview).not.toContain('…');
  });
});
