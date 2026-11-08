import { describe, it, expect } from 'vitest';
import { DailyRequestCap } from '../dailyCap';

describe('DailyRequestCap', () => {
  it('admits requests up to the per-IP limit, then refuses that IP only', () => {
    const cap = new DailyRequestCap(() => ({ global: 100, perIp: 2 }));
    expect(cap.tryAdmit('1.1.1.1')).toBe('ok');
    expect(cap.tryAdmit('1.1.1.1')).toBe('ok');
    expect(cap.tryAdmit('1.1.1.1')).toBe('ip-limit');
    expect(cap.tryAdmit('2.2.2.2')).toBe('ok');
  });

  it('refuses everyone once the global limit is reached', () => {
    const cap = new DailyRequestCap(() => ({ global: 3, perIp: 10 }));
    expect(cap.tryAdmit('a')).toBe('ok');
    expect(cap.tryAdmit('b')).toBe('ok');
    expect(cap.tryAdmit('c')).toBe('ok');
    expect(cap.tryAdmit('d')).toBe('global-limit');
    expect(cap.tryAdmit('a')).toBe('global-limit');
  });

  it('does not count refused requests against the global total', () => {
    const cap = new DailyRequestCap(() => ({ global: 3, perIp: 1 }));
    expect(cap.tryAdmit('a')).toBe('ok');
    for (let i = 0; i < 20; i++) expect(cap.tryAdmit('a')).toBe('ip-limit');
    expect(cap.tryAdmit('b')).toBe('ok');
    expect(cap.tryAdmit('c')).toBe('ok');
    expect(cap.tryAdmit('d')).toBe('global-limit');
  });

  it('resets at the UTC day boundary', () => {
    let now = new Date('2026-11-08T23:59:59Z');
    const cap = new DailyRequestCap(() => ({ global: 1, perIp: 1 }), () => now);
    expect(cap.tryAdmit('a')).toBe('ok');
    expect(cap.tryAdmit('a')).toBe('global-limit');
    now = new Date('2026-11-09T00:00:01Z');
    expect(cap.tryAdmit('a')).toBe('ok');
  });

  it('buckets a missing IP together instead of exempting it', () => {
    const cap = new DailyRequestCap(() => ({ global: 100, perIp: 1 }));
    expect(cap.tryAdmit(undefined)).toBe('ok');
    expect(cap.tryAdmit(undefined)).toBe('ip-limit');
  });

  it('reads limits on every call, so a config change takes effect', () => {
    let perIp = 1;
    const cap = new DailyRequestCap(() => ({ global: 100, perIp }));
    expect(cap.tryAdmit('a')).toBe('ok');
    expect(cap.tryAdmit('a')).toBe('ip-limit');
    perIp = 2;
    expect(cap.tryAdmit('a')).toBe('ok');
  });
});
