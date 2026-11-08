import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock('@synora/database', () => ({
  prisma: { workspaceInvitation: { findFirst: mocks.findFirst } },
}));

import { assertRegistrationAllowed, registrationMode } from '../registrationPolicy';
import { ForbiddenException } from '@synora/shared';

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv;

describe('registrationMode', () => {
  it('defaults to invite when unset', () => {
    expect(registrationMode(env({}))).toBe('invite');
  });

  it('is open only for the exact word "open" (case and space tolerant)', () => {
    expect(registrationMode(env({ REGISTRATION_MODE: 'open' }))).toBe('open');
    expect(registrationMode(env({ REGISTRATION_MODE: ' OPEN ' }))).toBe('open');
  });

  it('fails closed on a typo or any other value', () => {
    for (const value of ['opne', 'public', 'true', '1', '', '*']) {
      expect(registrationMode(env({ REGISTRATION_MODE: value }))).toBe('invite');
    }
  });
});

describe('assertRegistrationAllowed', () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.findFirst.mockResolvedValue(null);
  });

  it('lets anyone through in open mode without touching the database', async () => {
    await expect(assertRegistrationAllowed('anyone@example.com', env({ REGISTRATION_MODE: 'open' }))).resolves.toBeUndefined();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an uninvited email in invite mode with 403', async () => {
    const error = await assertRegistrationAllowed('stranger@example.com', env({})).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the mode value is a typo', async () => {
    await expect(assertRegistrationAllowed('stranger@example.com', env({ REGISTRATION_MODE: 'opne' }))).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it('admits an allowlisted email regardless of case, without a database lookup', async () => {
    const e = env({ REGISTRATION_ALLOWLIST: 'Founder@Example.com, other@example.com' });
    await expect(assertRegistrationAllowed('founder@example.com', e)).resolves.toBeUndefined();
    await expect(assertRegistrationAllowed('OTHER@EXAMPLE.COM', e)).resolves.toBeUndefined();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('admits an email that holds a live invitation', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'inv1' });
    await expect(assertRegistrationAllowed('invited@example.com', env({}))).resolves.toBeUndefined();
  });

  it('only counts invitations that are unaccepted, unrevoked and unexpired', async () => {
    await assertRegistrationAllowed('invited@example.com', env({})).catch(() => undefined);
    const where = mocks.findFirst.mock.calls[0][0].where;
    expect(where.acceptedAt).toBeNull();
    expect(where.revokedAt).toBeNull();
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
    expect(where.email).toEqual({ equals: 'invited@example.com', mode: 'insensitive' });
  });

  it('gives the same message for every refusal', async () => {
    const a = await assertRegistrationAllowed('a@example.com', env({})).catch((e: Error) => e.message);
    const b = await assertRegistrationAllowed('b@example.com', env({ REGISTRATION_ALLOWLIST: 'z@example.com' })).catch(
      (e: Error) => e.message
    );
    expect(a).toBe(b);
    expect(a).toBe('Registration is by invitation only.');
  });

  it('an allowlist entry does not admit a different address that merely contains it', async () => {
    const e = env({ REGISTRATION_ALLOWLIST: 'me@example.com' });
    await expect(assertRegistrationAllowed('me@example.com.evil.test', e)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertRegistrationAllowed('xme@example.com', e)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
