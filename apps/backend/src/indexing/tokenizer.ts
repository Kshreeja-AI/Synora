/**
 * Provider-agnostic, approximate tokenizer used only by the chunk
 * generator to size chunks — never the tokenizer any embedding provider
 * actually bills against (each provider's own token accounting, already
 * handled in `../embeddings/`, remains authoritative for cost). This one
 * exists so chunk boundaries are chosen consistently regardless of which
 * embedding provider ultimately processes them, without adding a
 * dependency on any single provider's real tokenizer (e.g. `tiktoken`,
 * which is OpenAI-specific).
 */
export interface Tokenizer {
  countTokens(text: string): number;
  /** Splits `text` into whitespace/punctuation-bounded tokens, in order — used to size a chunk without cutting a token in half. */
  tokenize(text: string): string[];
}

const TOKEN_PATTERN = /\S+/g;

/**
 * Whitespace/punctuation-run tokenization — the same coarse approximation
 * `../embeddings/shared.ts`'s `estimateTokensFromChars` uses via a
 * character-count heuristic, but expressed as real token boundaries so
 * the chunk generator can size a chunk by "first N tokens" rather than
 * "first N characters", which can otherwise split a word mid-token at a
 * chunk boundary.
 */
export class SimpleTokenizer implements Tokenizer {
  tokenize(text: string): string[] {
    return text.match(TOKEN_PATTERN) ?? [];
  }

  countTokens(text: string): number {
    return this.tokenize(text).length;
  }
}

let defaultTokenizer: Tokenizer | null = null;

export function getTokenizer(): Tokenizer {
  if (!defaultTokenizer) {
    defaultTokenizer = new SimpleTokenizer();
  }
  return defaultTokenizer;
}

export function resetTokenizerForTests(): void {
  defaultTokenizer = null;
}
