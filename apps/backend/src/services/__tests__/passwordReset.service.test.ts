import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import { issuePasswordResetToken, consumePasswordResetToken } from '../passwordReset.service';

describe('passwordReset.service', () => {
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
    const email = `pwreset-${Date.now()}-${Math.random()}@example.com`;
    testEmails.push(email);
    return prisma.user.create({ data: { email, password: 'irrelevant-for-this-test' } });
  }

  it('issues a token that is stored hashed, not in plaintext', async () => {
    const user = await makeUser();
    const rawToken = await issuePasswordResetToken(user.id);

    const record = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(record).not.toBeNull();
    expect(record!.tokenHash).not.toBe(rawToken);
  });

  it('consumes a valid token exactly once', async () => {
    const user = await makeUser();
    const rawToken = await issuePasswordResetToken(user.id);

    const first = await consumePasswordResetToken(rawToken);
    expect(first?.userId).toBe(user.id);

    const second = await consumePasswordResetToken(rawToken);
    expect(second).toBeNull();
  });

  it('rejects an unknown token', async () => {
    const result = await consumePasswordResetToken('not-a-real-token');
    expect(result).toBeNull();
  });

  it('rejects an expired token', async () => {
    const user = await makeUser();
    const rawToken = await issuePasswordResetToken(user.id);

    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await consumePasswordResetToken(rawToken)).toBeNull();
  });

  it('invalidates a previously issued, still-unused token when a new one is requested', async () => {
    const user = await makeUser();
    const firstToken = await issuePasswordResetToken(user.id);
    await issuePasswordResetToken(user.id);

    expect(await consumePasswordResetToken(firstToken)).toBeNull();
  });
});
