import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { issueTokens } from '../token.service';
import {
  parseUserAgent,
  listSessions,
  revokeSession,
  revokeAllSessions,
  revokeOtherSessions,
} from '../session.service';

describe('session.service parseUserAgent()', () => {
  it('identifies common browser/OS combinations', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      )
    ).toBe('Chrome on macOS');
    expect(
      parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0')
    ).toBe('Firefox on Windows');
    expect(
      parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')
    ).toBe('Safari on iOS');
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'
      )
    ).toBe('Edge on Windows');
    expect(parseUserAgent('Linux; Android 13; Chrome/120.0')).toBe('Chrome on Android');
  });

  it('falls back gracefully for missing or unrecognized user agents', () => {
    expect(parseUserAgent(null)).toBe('Unknown device');
    expect(parseUserAgent(undefined)).toBe('Unknown device');
    expect(parseUserAgent('some-obscure-bot/1.0')).toBe('Unknown browser on Unknown OS');
  });
});

describe('session.service (listSessions / revoke*)', () => {
  const testEmails: string[] = [];

  beforeAll(async () => {
    await initConfig();
  });

  afterEach(async () => {
    if (testEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
      testEmails.length = 0;
    }
  });

  async function makeUser() {
    const email = `session-svc-${Date.now()}-${Math.random()}@example.com`;
    testEmails.push(email);
    return prisma.user.create({ data: { email, password: 'irrelevant-for-this-test' } });
  }

  it('lists only active sessions and flags the current one', async () => {
    const user = await makeUser();
    const a = await issueTokens(
      { userId: user.id, email: user.email, role: user.role },
      { userAgent: 'Chrome/120.0 Macintosh', ipAddress: '10.0.0.1' }
    );
    const b = await issueTokens(
      { userId: user.id, email: user.email, role: user.role },
      { userAgent: 'Firefox/121.0 Windows', ipAddress: '10.0.0.2' }
    );

    const sessions = await listSessions(user.id, b.sessionId);
    expect(sessions).toHaveLength(2);
    const current = sessions.find((s) => s.id === b.sessionId);
    const other = sessions.find((s) => s.id === a.sessionId);
    expect(current?.isCurrent).toBe(true);
    expect(other?.isCurrent).toBe(false);
  });

  it('excludes revoked and expired sessions', async () => {
    const user = await makeUser();
    const active = await issueTokens({ userId: user.id, email: user.email, role: user.role });
    const revoked = await issueTokens({ userId: user.id, email: user.email, role: user.role });
    await revokeSession(user.id, revoked.sessionId);

    const sessions = await listSessions(user.id);
    expect(sessions.map((s) => s.id)).toEqual([active.sessionId]);
  });

  it('revokeSession refuses to revoke another user\'s session', async () => {
    const owner = await makeUser();
    const attacker = await makeUser();
    const session = await issueTokens({ userId: owner.id, email: owner.email, role: owner.role });

    const result = await revokeSession(attacker.id, session.sessionId);
    expect(result).toBe(false);

    const stillActive = await listSessions(owner.id);
    expect(stillActive.map((s) => s.id)).toContain(session.sessionId);
  });

  it('revokeAllSessions revokes every active session including the current one', async () => {
    const user = await makeUser();
    await issueTokens({ userId: user.id, email: user.email, role: user.role });
    await issueTokens({ userId: user.id, email: user.email, role: user.role });

    const count = await revokeAllSessions(user.id);
    expect(count).toBe(2);
    expect(await listSessions(user.id)).toHaveLength(0);
  });

  it('revokeOtherSessions keeps the excepted session active', async () => {
    const user = await makeUser();
    const keep = await issueTokens({ userId: user.id, email: user.email, role: user.role });
    await issueTokens({ userId: user.id, email: user.email, role: user.role });

    const count = await revokeOtherSessions(user.id, keep.sessionId);
    expect(count).toBe(1);

    const remaining = await listSessions(user.id);
    expect(remaining.map((s) => s.id)).toEqual([keep.sessionId]);
  });
});
