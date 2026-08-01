import { describe, it, expect } from 'vitest';
import { chunkText } from '../chunking';

describe('chunkText', () => {
  it('returns an empty array for empty text', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns a single chunk when text already fits chunkSize', () => {
    const chunks = chunkText('short text', { chunkSize: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('short text');
    expect(chunks[0].startOffset).toBe(0);
    expect(chunks[0].endOffset).toBe('short text'.length);
  });

  it('rejects overlap >= chunkSize', () => {
    expect(() => chunkText('some text here', { chunkSize: 10, overlap: 10 })).toThrow(/overlap/i);
  });

  describe('fixed strategy', () => {
    it('splits into fixed-size windows with overlap', () => {
      const text = 'a'.repeat(25);
      const chunks = chunkText(text, { strategy: 'fixed', chunkSize: 10, overlap: 2 });

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].text.length).toBe(10);
      // Reconstructing offsets: chunk boundaries should be consistent with the step size (chunkSize - overlap).
      expect(chunks[1].startOffset).toBe(8);
    });

    it('covers the entire text with no gaps', () => {
      const text = 'The quick brown fox jumps over the lazy dog. '.repeat(5);
      const chunks = chunkText(text, { strategy: 'fixed', chunkSize: 50, overlap: 10 });
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.endOffset).toBe(text.length);
    });
  });

  describe('sentence strategy', () => {
    it('never splits a chunk in the middle of a sentence', () => {
      const text = 'First sentence here. Second sentence here. Third one.';
      const chunks = chunkText(text, { strategy: 'sentence', chunkSize: 30, overlap: 0 });

      for (const chunk of chunks) {
        expect(chunk.text.trim().length).toBeGreaterThan(0);
      }
      // Every chunk should end with sentence-ending punctuation (the last chunk always will).
      expect(chunks[chunks.length - 1].text.trim().endsWith('.')).toBe(true);
    });

    it('falls back to fixed-size splitting for a single oversized sentence', () => {
      const longSentence = 'a'.repeat(100) + '.';
      const chunks = chunkText(longSentence, { strategy: 'sentence', chunkSize: 30, overlap: 5 });
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('recursive strategy', () => {
    it('splits multi-paragraph text along paragraph boundaries first', () => {
      const text = 'Paragraph one is short.\n\nParagraph two is also short.\n\nParagraph three too.';
      const chunks = chunkText(text, { strategy: 'recursive', chunkSize: 1000 });

      // Each paragraph fits comfortably within chunkSize, so we expect one chunk per paragraph.
      expect(chunks).toHaveLength(3);
      expect(chunks[0].text).toContain('Paragraph one');
      expect(chunks[2].text).toContain('Paragraph three');
    });

    it('falls back to sentence chunking for single-paragraph text', () => {
      const text = 'Sentence one. Sentence two. Sentence three.';
      const chunks = chunkText(text, { strategy: 'recursive', chunkSize: 20, overlap: 5 });
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  it('defaults to the recursive strategy when none is specified', () => {
    const withDefault = chunkText('Paragraph one.\n\nParagraph two.');
    const withExplicit = chunkText('Paragraph one.\n\nParagraph two.', { strategy: 'recursive' });
    expect(withDefault).toEqual(withExplicit);
  });
});
