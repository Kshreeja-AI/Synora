import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCorpus, loadCorpusFile, retrieve, formatContext, NOT_PUBLISHED } from '../corpus';

const CORPUS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/portfolio-corpus.jsonl');

const small = parseCorpus(
  [
    JSON.stringify({ id: 'a', source: 's', text: 'Keshav studies an MBA in Fintech with AI at Invertis University' }),
    JSON.stringify({ id: 'b', source: 's', text: 'Synora is a multi-model AI router with verification' }),
    JSON.stringify({ id: 'c', source: 's', text: 'Based in Shahjahanpur, Uttar Pradesh, India' }),
  ].join('\n')
);

describe('parseCorpus', () => {
  it('skips malformed and empty lines but keeps the rest', () => {
    const chunks = parseCorpus('{"id":"x","text":"ok"}\nnot json\n\n{"id":"y","text":"  "}\n{"text":"no id"}');
    expect(chunks.map((c) => c.text)).toEqual(['ok', 'no id']);
  });
});

describe('retrieve', () => {
  it('ranks the chunk that overlaps the question first', () => {
    expect(retrieve(small, 'Where is he based?', 1)[0].id).toBe('c');
    expect(retrieve(small, 'What is Synora?', 1)[0].id).toBe('b');
    expect(retrieve(small, 'which university MBA fintech', 1)[0].id).toBe('a');
  });

  it('still returns context when nothing overlaps (no score-based refusal)', () => {
    const out = retrieve(small, 'zzzz qqqq', 2);
    expect(out).toHaveLength(2);
  });

  it('returns nothing only when there is no corpus at all', () => {
    expect(retrieve([], 'anything')).toEqual([]);
  });

  it('respects k', () => {
    expect(retrieve(small, 'Synora university India', 2)).toHaveLength(2);
  });
});

describe('formatContext', () => {
  it('numbers chunks and keeps their ids', () => {
    const text = formatContext(small.slice(0, 2));
    expect(text).toContain('[1] (a)');
    expect(text).toContain('[2] (b)');
  });
});

describe('the shipped corpus', () => {
  const chunks = loadCorpusFile(CORPUS_PATH);

  it('loads all 67 chunks from the repo copy', () => {
    expect(chunks).toHaveLength(67);
  });

  it('retrieves the person entry for a question about who he is', () => {
    const ids = retrieve(chunks, 'Who is Keshav and where is he based?').map((c) => c.id);
    expect(ids).toContain('portfolio.json:person');
  });

  it('returns [] for a missing file instead of throwing', () => {
    expect(loadCorpusFile('/nonexistent/corpus.jsonl')).toEqual([]);
  });
});

describe('NOT_PUBLISHED', () => {
  it('is the exact refusal sentence from the contract', () => {
    expect(NOT_PUBLISHED).toBe('Not published on this portfolio.');
  });
});
