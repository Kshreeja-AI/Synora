/**
 * Daily request ceilings for the public assistant, global and per IP.
 *
 * The free tiers behind the assistant are a shared, finite quota. A per-minute
 * rate limit stops bursts but not a slow drain: one scripted client at 9
 * requests a minute is 12,960 a day and would exhaust every provider's free
 * allowance. These counters bound the day, per source and in total.
 *
 * In-memory by design. Render's free plan runs one instance, and a restart
 * resets the counters; that errs toward serving more, bounded by the token cap
 * (AI_GLOBAL_MAX_TOKENS_PER_DAY, in Postgres) which is the durable backstop.
 * Running several instances would multiply the ceilings; move the counters to
 * Redis before scaling out.
 */

export type DailyCapVerdict = 'ok' | 'ip-limit' | 'global-limit';

export interface DailyCapLimits {
  global: number;
  perIp: number;
}

/** Distinct IPs tracked per day. Past this, new sources are refused, not tracked. */
const MAX_TRACKED_IPS = 20_000;

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class DailyRequestCap {
  private day = '';
  private globalCount = 0;
  private readonly perIp = new Map<string, number>();

  constructor(
    private readonly limits: () => DailyCapLimits,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Counts the request when it is admitted. Refusals are not counted. */
  tryAdmit(ip: string | undefined): DailyCapVerdict {
    const today = utcDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.globalCount = 0;
      this.perIp.clear();
    }

    const { global, perIp } = this.limits();
    if (this.globalCount >= global) return 'global-limit';

    const key = ip && ip.length > 0 ? ip : 'unknown';
    const seen = this.perIp.get(key);
    if (seen === undefined && this.perIp.size >= MAX_TRACKED_IPS) return 'global-limit';
    if ((seen ?? 0) >= perIp) return 'ip-limit';

    this.perIp.set(key, (seen ?? 0) + 1);
    this.globalCount += 1;
    return 'ok';
  }
}
