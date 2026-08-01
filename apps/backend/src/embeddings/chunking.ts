import { ChunkingOptions, ChunkingStrategyName, TextChunk } from './types';

/**
 * Document-chunking abstraction used by `EmbeddingService.embedStream()` to
 * split a large document into embeddable pieces before batching them to a
 * provider. Every strategy is pure, synchronous, and provider-agnostic —
 * nothing here knows about any embedding provider's batch size or API.
 */

export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 100;
const DEFAULT_STRATEGY: ChunkingStrategyName = 'recursive';

function makeChunk(text: string, index: number, startOffset: number): TextChunk {
  return { text, index, startOffset, endOffset: startOffset + text.length };
}

/**
 * Splits text into fixed-size windows with a trailing overlap carried into
 * the next chunk, so a sentence or fact split across a chunk boundary still
 * appears whole in at least one chunk's embedding.
 */
function chunkFixed(text: string, chunkSize: number, overlap: number): TextChunk[] {
  if (text.length <= chunkSize) {
    return text.length > 0 ? [makeChunk(text, 0, 0)] : [];
  }

  const chunks: TextChunk[] = [];
  const step = Math.max(1, chunkSize - overlap);
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(makeChunk(text.slice(start, end), index, start));
    index += 1;
    if (end >= text.length) break;
    start += step;
  }

  return chunks;
}

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/**
 * Packs whole sentences into chunks up to `chunkSize` characters, so a
 * chunk boundary never lands mid-sentence. Falls back to `chunkFixed` for
 * any single sentence that alone exceeds `chunkSize` (rare, but a
 * transcript or code block with no punctuation-based sentence breaks would
 * otherwise become one oversized, unsplit chunk).
 */
function chunkBySentence(text: string, chunkSize: number, overlap: number): TextChunk[] {
  const sentences = text.split(SENTENCE_BOUNDARY).filter((s) => s.length > 0);
  const chunks: TextChunk[] = [];
  let current = '';
  let currentStart = 0;
  let index = 0;
  let cursor = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(makeChunk(current, index, currentStart));
      index += 1;
    }
  };

  for (const sentence of sentences) {
    const sentenceStart = text.indexOf(sentence, cursor);
    cursor = sentenceStart + sentence.length;

    if (sentence.length > chunkSize) {
      flush();
      current = '';
      for (const piece of chunkFixed(sentence, chunkSize, overlap)) {
        chunks.push(makeChunk(piece.text, index, sentenceStart + piece.startOffset));
        index += 1;
      }
      continue;
    }

    const candidate = current.length === 0 ? sentence : `${current} ${sentence}`;
    if (candidate.length > chunkSize) {
      flush();
      current = sentence;
      currentStart = sentenceStart;
    } else {
      if (current.length === 0) currentStart = sentenceStart;
      current = candidate;
    }
  }
  flush();

  return chunks;
}

/**
 * Prefers paragraph breaks, then sentence breaks, then falls back to fixed
 * character windows — the same coarse-to-fine strategy popularized by
 * LangChain's `RecursiveCharacterTextSplitter`. Each paragraph is packed
 * against `chunkSize` independently, so unrelated sections of a long
 * document don't get merged into the same embedding just because they're
 * individually short.
 */
function chunkRecursive(text: string, chunkSize: number, overlap: number): TextChunk[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  if (paragraphs.length <= 1) {
    return chunkBySentence(text, chunkSize, overlap);
  }

  const chunks: TextChunk[] = [];
  let cursor = 0;
  let index = 0;

  for (const paragraph of paragraphs) {
    const paragraphStart = text.indexOf(paragraph, cursor);
    cursor = paragraphStart + paragraph.length;

    const pieces =
      paragraph.length > chunkSize
        ? chunkBySentence(paragraph, chunkSize, overlap)
        : [makeChunk(paragraph, 0, 0)];

    for (const piece of pieces) {
      chunks.push(makeChunk(piece.text, index, paragraphStart + piece.startOffset));
      index += 1;
    }
  }

  return chunks;
}

/**
 * Splits `text` into embeddable chunks per `options`. Returns a single
 * chunk spanning the whole text when it already fits within `chunkSize` —
 * chunking a short message is a no-op, not an error.
 */
export function chunkText(text: string, options: ChunkingOptions = {}): TextChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  // The default overlap scales with chunkSize rather than being a fixed 100
  // chars: a caller who only overrides `chunkSize` (a very common case —
  // shrinking chunks for a small-context model, say) would otherwise hit
  // the overlap>=chunkSize guard below whenever their custom chunkSize fell
  // under 100, for no reason they specified. An *explicit* `overlap` is
  // always honored (and still validated) exactly as given.
  const overlap = options.overlap ?? Math.min(DEFAULT_CHUNK_OVERLAP, Math.floor(chunkSize / 10));
  const strategy = options.strategy ?? DEFAULT_STRATEGY;

  if (overlap >= chunkSize) {
    throw new Error(
      `Chunking overlap (${overlap}) must be smaller than chunkSize (${chunkSize}).`
    );
  }

  if (text.length === 0) return [];

  switch (strategy) {
    case 'fixed':
      return chunkFixed(text, chunkSize, overlap);
    case 'sentence':
      return chunkBySentence(text, chunkSize, overlap);
    case 'recursive':
      return chunkRecursive(text, chunkSize, overlap);
    default: {
      const exhaustiveCheck: never = strategy;
      throw new Error(`Unknown chunking strategy: ${String(exhaustiveCheck)}`);
    }
  }
}
