import { describe, it, expect } from 'vitest';
import { durationToMs } from '../token.service';

describe('token.service durationToMs()', () => {
  it('parses day/hour/minute/second/millisecond units', () => {
    expect(durationToMs('7d')).toBe(7 * 86_400_000);
    expect(durationToMs('15m')).toBe(15 * 60_000);
    expect(durationToMs('24h')).toBe(24 * 3_600_000);
    expect(durationToMs('30s')).toBe(30_000);
    expect(durationToMs('500ms')).toBe(500);
  });

  it('treats a bare number as seconds', () => {
    expect(durationToMs('3600')).toBe(3_600_000);
  });

  it('tolerates surrounding whitespace', () => {
    expect(durationToMs('  7d ')).toBe(7 * 86_400_000);
  });

  it('throws on an unparseable duration rather than silently returning NaN', () => {
    expect(() => durationToMs('soon')).toThrow();
    expect(() => durationToMs('')).toThrow();
  });
});
