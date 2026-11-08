import { readFileSync } from 'node:fs';

/**
 * The published portfolio facts the assistant may answer from.
 *
 * Loaded once at boot from a JSONL file (one {"id","source","text"} per line).
 * Retrieval is plain token overlap, and it NEVER decides whether to answer:
 * the top chunks are always passed to the model, and the model is told to say
 * "Not published on this portfolio." when they do not contain the answer. A
 * similarity cut-off was deliberately not used for refusal -- overlap scores on
 * a 67-chunk corpus are too noisy to separate "absent" from "phrased
 * differently", and a wrong refusal is worse than letting the model look.
 */

export interface CorpusChunk {
  id: string;
  source: string;
  text: string;
}

export const NOT_PUBLISHED = 'Not published on this portfolio.';

const MAX_CONTEXT_CHARS = 7_000;
const DEFAULT_TOP_K = 6;

const STOPWORDS = new Set(
  'a an the is are was were be been of in on at to for from with by and or not what who whom which when where how why does do did has have had his her their he she they it this that these those about tell me your you can could would should i my keshav kumar singh'.split(
    ' '
  )
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function parseCorpus(jsonl: string): CorpusChunk[] {
  const chunks: CorpusChunk[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<CorpusChunk>;
      if (typeof row.text === 'string' && row.text.trim()) {
        chunks.push({
          id: typeof row.id === 'string' ? row.id : `chunk-${chunks.length}`,
          source: typeof row.source === 'string' ? row.source : 'unknown',
          text: row.text,
        });
      }
    } catch {
      // A malformed line is skipped; the rest of the corpus is still usable.
    }
  }
  return chunks;
}

/** Returns [] (and the caller falls back to the built-in facts) when the file is unreadable. */
export function loadCorpusFile(path: string): CorpusChunk[] {
  try {
    return parseCorpus(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Top-k chunks by IDF-weighted token overlap. With no overlap at all the first
 * k chunks (the person/summary entries in file order) are returned, so the
 * model always has something to ground on.
 */
export function retrieve(
  chunks: readonly CorpusChunk[],
  question: string,
  k: number = DEFAULT_TOP_K
): CorpusChunk[] {
  if (chunks.length === 0) return [];
  const queryTokens = new Set(tokens(question));

  const docs = chunks.map((c) => new Set(tokens(`${c.id} ${c.text}`)));
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of doc) df.set(t, (df.get(t) ?? 0) + 1);

  const scored = chunks.map((chunk, index) => {
    let score = 0;
    for (const t of queryTokens) {
      if (docs[index].has(t)) score += Math.log(1 + chunks.length / (df.get(t) ?? 1));
    }
    return { chunk, index, score };
  });

  const matched = scored.filter((s) => s.score > 0);
  const picked =
    matched.length > 0 ? matched.sort((a, b) => b.score - a.score || a.index - b.index) : scored;

  const out: CorpusChunk[] = [];
  let used = 0;
  for (const { chunk } of picked.slice(0, k)) {
    if (used + chunk.text.length > MAX_CONTEXT_CHARS && out.length > 0) break;
    out.push(chunk);
    used += chunk.text.length;
  }
  return out;
}

export function formatContext(chunks: readonly CorpusChunk[]): string {
  return chunks.map((c, i) => `[${i + 1}] (${c.id})\n${c.text}`).join('\n\n');
}
