/**
 * The schedule phrase parser: stricter than the resolver, because its
 * output RECURS. A misread search runs once; a misread schedule fires at
 * the wrong time every day until someone notices from the consequences.
 * So every ambiguity is a question, never a default.
 */

import { describe, it, expect } from 'vitest';
import { parseSchedulePhrase } from '../schedule-phrase';

describe('parseSchedulePhrase', () => {
  it('parses a full daily phrase: cadence, time, zone', () => {
    const parsed = parseSchedulePhrase('every day at 9am Asia/Kolkata');
    expect(parsed).toEqual({
      status: 'parsed',
      kind: 'daily',
      atMinute: 540,
      timeZone: 'Asia/Kolkata',
      describe: 'every day at 09:00 (Asia/Kolkata)',
    });
  });

  it('reads minutes without am/pm as the 24-hour clock — the one documented convention', () => {
    const parsed = parseSchedulePhrase('every day at 21:30 Europe/Berlin');
    expect(parsed).toMatchObject({ status: 'parsed', atMinute: 21 * 60 + 30 });
  });

  it('handles the 12 o\'clock edge cases correctly', () => {
    expect(parseSchedulePhrase('every day at 12am UTC')).toMatchObject({ atMinute: 0 });
    expect(parseSchedulePhrase('every day at 12pm UTC')).toMatchObject({ atMinute: 720 });
  });

  it('asks instead of guessing when a bare hour could be am or pm', () => {
    // A schedule built on the wrong reading fires twelve hours off, daily.
    const parsed = parseSchedulePhrase('every day at 9 Asia/Kolkata');
    expect(parsed.status).toBe('incomplete');
    if (parsed.status === 'incomplete') expect(parsed.question).toMatch(/9am or 9pm/);
  });

  it('asks for a time when the cadence carries none', () => {
    const parsed = parseSchedulePhrase('every morning');
    expect(parsed.status).toBe('incomplete');
    if (parsed.status === 'incomplete') expect(parsed.question).toMatch(/what time/i);
  });

  it('asks for a zone rather than assuming one — the platform stores none', () => {
    const parsed = parseSchedulePhrase('every day at 9am');
    expect(parsed.status).toBe('incomplete');
    if (parsed.status === 'incomplete') {
      expect(parsed.question).toMatch(/time zone/i);
      // The question teaches the complete sentence, so it is asked once.
      expect(parsed.question).toContain('Asia/Kolkata');
    }
  });

  it('names an invalid zone instead of silently dropping it', () => {
    const parsed = parseSchedulePhrase('every day at 9am Mars/Olympus');
    expect(parsed.status).toBe('incomplete');
    if (parsed.status === 'incomplete') expect(parsed.question).toContain('Mars/Olympus');
  });

  it('parses "every hour" with no time or zone needed', () => {
    expect(parseSchedulePhrase('every hour')).toEqual({
      status: 'parsed',
      kind: 'interval',
      intervalMs: 3_600_000,
      describe: 'every hour',
    });
  });

  it('says plainly that weekly is not built, rather than asking useless follow-ups', () => {
    const parsed = parseSchedulePhrase('every monday at 9am UTC');
    expect(parsed.status).toBe('incomplete');
    if (parsed.status === 'incomplete') expect(parsed.question).toMatch(/not built yet/i);
  });

  it('asks how often when no cadence is present at all', () => {
    const parsed = parseSchedulePhrase('at 9am Asia/Kolkata');
    expect(parsed.status).toBe('incomplete');
    if (parsed.status === 'incomplete') expect(parsed.question).toMatch(/how often/i);
  });
});
