import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { prisma } from '@synora/database';
import { initConfig } from '../../config';
import {
  issueEmailVerificationToken,
  consumeEmailVerificationToken,
} from '../emailVerification.service';

describe('emailVerification.service', () => {
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
    const email = `verify-${Date.now()}-${Math.random()}@example.com`;
    testEmails.push(email);
    return prisma.user.create({ data: { email, password: 'irrelevant-for-this-test' } });
  }

  it('issues a token stored hashed, not in plaintext', async () => {
    const user = await makeUser();
    const rawToken = await issueEmailVerificationToken(user.id);

    const record = await prisma.emailVerificationToken.findFirst({ where: { userId: user.id } });
    expect(record!.tokenHash).not.toBe(rawToken);
  });

  it('marks the user emailVerified on consume, exactly once', async () => {
    const user = await makeUser();
    expect(user.emailVerified).toBeNull();

    const rawToken = await issueEmailVerificationToken(user.id);
    const result = await consumeEmailVerificationToken(rawToken);
    expect(result?.userId).toBe(user.id);

    const verifiedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(verifiedUser?.emailVerified).not.toBeNull();

    expect(await consumeEmailVerificationToken(rawToken)).toBeNull();
  });

  it('rejects an unknown token', async () => {
    expect(await consumeEmailVerificationToken('not-a-real-token')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const user = await makeUser();
    const rawToken = await issueEmailVerificationToken(user.id);

    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await consumeEmailVerificationToken(rawToken)).toBeNull();
  });

  it('invalidates a previous token when a new one is requested (resend)', async () => {
    const user = await makeUser();
    const firstToken = await issueEmailVerificationToken(user.id);
    await issueEmailVerificationToken(user.id);

    expect(await consumeEmailVerificationToken(firstToken)).toBeNull();
  });
});
