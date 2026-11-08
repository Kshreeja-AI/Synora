import type { SpeechToTextResult, TranscriptSegment } from './types';

/**
 * Subtitle export. Pure functions over segments the provider actually
 * returned. If a result has no segments there are no real timings, so these
 * return null instead of fabricating cue boundaries.
 */

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function timestamp(seconds: number, decimalSeparator: ',' | '.'): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${decimalSeparator}${pad(ms, 3)}`;
}

function usableSegments(result: SpeechToTextResult): readonly TranscriptSegment[] | null {
  const segments = result.segments?.filter((s) => s.text.length > 0);
  return segments && segments.length > 0 ? segments : null;
}

export function toSrt(result: SpeechToTextResult): string | null {
  const segments = usableSegments(result);
  if (!segments) return null;
  return (
    segments
      .map(
        (s, i) =>
          `${i + 1}\n${timestamp(s.startSeconds, ',')} --> ${timestamp(s.endSeconds, ',')}\n${s.text}\n`
      )
      .join('\n')
  );
}

export function toVtt(result: SpeechToTextResult): string | null {
  const segments = usableSegments(result);
  if (!segments) return null;
  const cues = segments
    .map((s) => `${timestamp(s.startSeconds, '.')} --> ${timestamp(s.endSeconds, '.')}\n${s.text}\n`)
    .join('\n');
  return `WEBVTT\n\n${cues}`;
}
