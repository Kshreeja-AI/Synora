/**
 * Detector window tests.
 *
 * This module exists to stop four copies of the same bookkeeping drifting
 * apart. It holds windows and episodes only — the comparison stays with
 * each detector, because three times this session the neighbouring
 * detector's comparison would have measured the wrong thing.
 */

import { describe, it, expect } from 'vitest';
import { DetectorWindow } from '../detector-window';

function fill(w: DetectorWindow<number>, key: string, value: number, n: number) {
  for (let i = 0; i < n; i++) w.push(key, value);
}

describe('detector-window', () => {
  it('reports insufficient data until both halves are large enough', () => {
    const w = new DetectorWindow<number>({ windowSize: 5, minBaselineSamples: 20 });

    fill(w, 'a', 1, 10);
    expect(w.slices('a').sufficientData).toBe(false);

    fill(w, 'a', 1, 15);
    expect(w.slices('a').sufficientData).toBe(true);
  });

  it('splits baseline from recent by recency', () => {
    const w = new DetectorWindow<number>({ windowSize: 3, minBaselineSamples: 2 });

    fill(w, 'a', 1, 5);
    w.push('a', 9);

    const slices = w.slices('a');
    expect(slices.recent).toEqual([1, 1, 9]);
    expect(slices.baseline).toEqual([1, 1, 1]);
  });

  it('keeps subjects entirely separate', () => {
    const w = new DetectorWindow<number>({ windowSize: 2, minBaselineSamples: 1 });

    fill(w, 'a', 1, 5);
    fill(w, 'b', 2, 3);

    expect(w.slices('a').totalSamples).toBe(5);
    expect(w.slices('b').totalSamples).toBe(3);
    expect(w.slices('b').recent).toEqual([2, 2]);
  });

  it('caps retained samples while still counting every one', () => {
    const w = new DetectorWindow<number>({ windowSize: 2, minBaselineSamples: 1, maxSamples: 10 });

    fill(w, 'a', 1, 50);

    // Memory is bounded; the request count is not lost to that bound.
    expect(w.slices('a').baseline.length + w.slices('a').recent.length).toBe(10);
    expect(w.slices('a').totalSamples).toBe(50);
  });

  it('reports an unknown subject as empty rather than throwing', () => {
    const w = new DetectorWindow<number>({ windowSize: 2, minBaselineSamples: 1 });
    expect(w.slices('nope').sufficientData).toBe(false);
    expect(w.requestCount('nope')).toBe(0);
  });

  describe('episode gating', () => {
    it('alerts on the transition, then stays quiet while the condition holds', () => {
      const w = new DetectorWindow<number>({ windowSize: 2, minBaselineSamples: 1 });
      w.push('a', 1);

      expect(w.shouldAlert('a', true)).toBe(true);
      expect(w.shouldAlert('a', true)).toBe(false);
      expect(w.shouldAlert('a', true)).toBe(false);
    });

    it('re-arms once the condition clears', () => {
      const w = new DetectorWindow<number>({ windowSize: 2, minBaselineSamples: 1 });
      w.push('a', 1);

      expect(w.shouldAlert('a', true)).toBe(true);
      expect(w.shouldAlert('a', false)).toBe(false);
      expect(w.shouldAlert('a', true)).toBe(true);
    });

    it('gates each subject independently', () => {
      const w = new DetectorWindow<number>({ windowSize: 2, minBaselineSamples: 1 });
      w.push('a', 1);
      w.push('b', 1);

      expect(w.shouldAlert('a', true)).toBe(true);
      // One subject alerting must not silence another.
      expect(w.shouldAlert('b', true)).toBe(true);
    });

    it('never alerts for a subject that has no samples', () => {
      const w = new DetectorWindow<number>({ windowSize: 2, minBaselineSamples: 1 });
      expect(w.shouldAlert('nope', true)).toBe(false);
    });
  });

  it('clear forgets everything', () => {
    const w = new DetectorWindow<number>({ windowSize: 2, minBaselineSamples: 1 });
    fill(w, 'a', 1, 5);

    w.clear();

    expect(w.keys()).toEqual([]);
    expect(w.slices('a').totalSamples).toBe(0);
  });
});
