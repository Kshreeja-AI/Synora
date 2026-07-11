import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, ok } from './result.js';

describe('Result', () => {
  it('narrows to value on isOk', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it('narrows to error on isErr', () => {
    const result = err('boom');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe('boom');
    }
  });
});
