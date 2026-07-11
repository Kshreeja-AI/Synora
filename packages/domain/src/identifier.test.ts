import { describe, expect, it } from 'vitest';
import { Identifier } from './identifier.js';

describe('Identifier', () => {
  it('generates unique values', () => {
    const a = Identifier.generate();
    const b = Identifier.generate();
    expect(a.equals(b)).toBe(false);
  });

  it('is equal when values match', () => {
    const a = new Identifier('same-id');
    const b = new Identifier('same-id');
    expect(a.equals(b)).toBe(true);
  });
});
