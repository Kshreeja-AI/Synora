/**
 * From "every day at 9am Asia/Kolkata" to a schedule the DST-correct
 * scheduler accepts — or to the one question that would get there.
 *
 * DETERMINISTIC, like the understander and the resolver, and stricter than
 * either, because the output RECURS: a misread search runs once, a misread
 * schedule acts every day at the wrong time until someone notices from the
 * consequences. So this parser refuses every ambiguity:
 *
 *   - "every morning" carries no hour            → asks for one
 *   - "at 9" could be 09:00 or 21:00             → asks for am/pm or minutes
 *   - a time with no zone is a guess about the   → asks for the zone, and
 *     person's clock (the platform stores none)     teaches the exact form
 *   - "every monday" is a cadence the scheduler  → says so plainly, with
 *     does not support yet                          what IS supported
 *
 * "at 9:30" with minutes and no am/pm is read as the 24-hour clock — the
 * one documented convention this file adopts rather than asks about.
 *
 * The zone is validated against the runtime's own zone database (Intl),
 * the same authority the schedule registry trusts — never a hand-kept list
 * that would drift from it.
 */

export type ParsedSchedulePhrase =
  | {
      status: 'parsed';
      kind: 'daily';
      /** Wall-clock minute of day IN the zone (the scheduler's contract). */
      atMinute: number;
      timeZone: string;
      /** Human sentence of what was understood, for the confirmation. */
      describe: string;
    }
  | { status: 'parsed'; kind: 'interval'; intervalMs: number; describe: string }
  | {
      /** Not a failure: the one question that would complete the schedule. */
      status: 'incomplete';
      question: string;
    };

const EXAMPLE = `Say e.g. "every day at 9am Asia/Kolkata" or "every hour".`;

function isRealZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** IANA-shaped token ("Asia/Kolkata", "America/New_York") or UTC, original case. */
function findZone(originalText: string): { zone?: string; invalid?: string } {
  const iana = originalText.match(/\b[A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?\b/);
  if (iana) {
    return isRealZone(iana[0]) ? { zone: iana[0] } : { invalid: iana[0] };
  }
  if (/\bUTC\b/i.test(originalText)) return { zone: 'UTC' };
  return {};
}

export function parseSchedulePhrase(originalText: string): ParsedSchedulePhrase {
  const text = originalText.toLowerCase();

  if (/\bevery\s+hour\b|\bhourly\b/.test(text)) {
    return {
      status: 'parsed',
      kind: 'interval',
      intervalMs: 60 * 60 * 1000,
      describe: 'every hour',
    };
  }

  // Cadences the scheduler genuinely does not support yet. Said plainly —
  // a person told "which day?" for a weekly schedule Synora cannot create
  // would be having their time wasted politely.
  if (/\bevery\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bweekly\b|\bmonthly\b/.test(text)) {
    return {
      status: 'incomplete',
      question: `Synora can schedule "every day at <time> <zone>" or "every hour" today — weekly and monthly schedules are not built yet.`,
    };
  }

  const daily = /\bevery\s+(day|morning|afternoon|evening|night)\b|\bdaily\b|\beach\s+day\b/.test(text);
  if (!daily) {
    return { status: 'incomplete', question: `How often should this run? ${EXAMPLE}` };
  }

  const time = text.match(/\bat\s+(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\b/);
  if (!time) {
    return { status: 'incomplete', question: `At what time each day? ${EXAMPLE}` };
  }

  let hour = Number(time[1]);
  const minute = time[2] ? Number(time[2]) : 0;
  const meridiem = time[3];

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return { status: 'incomplete', question: `"${time[1]}${meridiem}" is not a time I can read. ${EXAMPLE}` };
    }
    if (meridiem === 'am') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (!time[2]) {
    // "at 9" alone: 09:00 and 21:00 are both reasonable readings, and a
    // schedule built on the wrong one fires twelve hours off, daily.
    return {
      status: 'incomplete',
      question: `Did you mean ${time[1]}am or ${time[1]}pm? Say the time with am/pm, or use the 24-hour clock like "at ${Number(time[1]) + 12}:00".`,
    };
  } else if (hour > 23) {
    return { status: 'incomplete', question: `"${time[1]}:${time[2]}" is not a time on the 24-hour clock. ${EXAMPLE}` };
  }

  const { zone, invalid } = findZone(originalText);
  if (invalid) {
    return {
      status: 'incomplete',
      question: `"${invalid}" is not a time zone this system knows. Use an IANA name like "Asia/Kolkata" or "Europe/Berlin", or "UTC".`,
    };
  }
  if (!zone) {
    // The platform stores no timezone for anyone, so a bare "9am" would be
    // a guess about the person's clock — wrong by hours, daily. One
    // teaching question; the full sentence works forever after.
    return {
      status: 'incomplete',
      question: `In which time zone? Say e.g. "every day at ${time[0].replace(/^at\s+/, '')} Asia/Kolkata" — Synora does not assume one.`,
    };
  }

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return {
    status: 'parsed',
    kind: 'daily',
    atMinute: hour * 60 + minute,
    timeZone: zone,
    describe: `every day at ${hh}:${mm} (${zone})`,
  };
}
