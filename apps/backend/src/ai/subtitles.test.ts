import { describe, it, expect } from 'vitest';
import { toSrt, toVtt } from './subtitles';
import type { SpeechToTextResult } from './types';

const base: SpeechToTextResult = { text: 'x', provider: 'p', model: 'm' };

describe('subtitle export', () => {
  const withSegments: SpeechToTextResult = {
    ...base,
    segments: [
      { startSeconds: 0, endSeconds: 1.5, text: 'Namaste' },
      { startSeconds: 3661.007, endSeconds: 3662, text: 'duniya' },
    ],
  };

  it('writes SRT with comma milliseconds and 1-based cue numbers', () => {
    expect(toSrt(withSegments)).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nNamaste\n\n2\n01:01:01,007 --> 01:01:02,000\nduniya\n'
    );
  });

  it('writes VTT with a header and dot milliseconds', () => {
    expect(toVtt(withSegments)).toBe(
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nNamaste\n\n01:01:01.007 --> 01:01:02.000\nduniya\n'
    );
  });

  it('returns null instead of inventing timings when there are no segments', () => {
    expect(toSrt(base)).toBeNull();
    expect(toVtt(base)).toBeNull();
    expect(toSrt({ ...base, segments: [] })).toBeNull();
    expect(toSrt({ ...base, segments: [{ startSeconds: 0, endSeconds: 1, text: '' }] })).toBeNull();
  });

  it('clamps negative times to zero', () => {
    const out = toSrt({ ...base, segments: [{ startSeconds: -2, endSeconds: 1, text: 'a' }] });
    expect(out).toContain('00:00:00,000 --> 00:00:01,000');
  });
});
