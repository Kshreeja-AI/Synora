/**
 * A typed injection token. Identity is the object reference (not the description string),
 * so two tokens with the same description never collide.
 */
export class Token<T> {
  private readonly _phantom?: T;

  constructor(readonly description: string) {}

  toString(): string {
    return `Token(${this.description})`;
  }
}

export function createToken<T>(description: string): Token<T> {
  return new Token<T>(description);
}
