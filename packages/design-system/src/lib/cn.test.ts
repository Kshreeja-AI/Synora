import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('resolves tailwind conflicts, last wins', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('bg-primary', 'bg-destructive')).toBe('bg-destructive');
  });

  it('keeps non-conflicting utilities', () => {
    expect(cn('px-2', 'py-4')).toBe('px-2 py-4');
  });
});
