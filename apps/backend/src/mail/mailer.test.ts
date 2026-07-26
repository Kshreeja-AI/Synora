import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initConfig } from '../config';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendAccountDeletedEmail,
} from './mailer';
import { getConsoleMailLog, clearConsoleMailLog } from './transports/console.transport';

describe('mailer facade (console transport)', () => {
  beforeAll(async () => {
    await initConfig();
  });

  beforeEach(() => {
    clearConsoleMailLog();
  });

  it('sends a verification email containing the token as a URL', async () => {
    await sendVerificationEmail({ to: 'user@example.com', name: 'Ada', token: 'raw-token-123' });

    const log = getConsoleMailLog();
    expect(log).toHaveLength(1);
    expect(log[0].to).toBe('user@example.com');
    expect(log[0].subject).toContain('Verify');
    expect(log[0].html).toContain('raw-token-123');
    expect(log[0].text).toContain('raw-token-123');
  });

  it('sends a password reset email containing the token as a URL', async () => {
    await sendPasswordResetEmail({ to: 'user@example.com', name: null, token: 'reset-token-456' });

    const log = getConsoleMailLog();
    expect(log).toHaveLength(1);
    expect(log[0].subject).toContain('Reset');
    expect(log[0].html).toContain('reset-token-456');
  });

  it('sends a password-changed notification with no token', async () => {
    await sendPasswordChangedEmail({ to: 'user@example.com', name: 'Ada' });

    const log = getConsoleMailLog();
    expect(log).toHaveLength(1);
    expect(log[0].subject).toContain('changed');
  });

  it('sends an account-deleted notification', async () => {
    await sendAccountDeletedEmail({ to: 'user@example.com', name: null });

    const log = getConsoleMailLog();
    expect(log).toHaveLength(1);
    expect(log[0].subject).toContain('deleted');
  });

  it('caps the in-memory log so it never grows unbounded', async () => {
    for (let i = 0; i < 210; i += 1) {
      await sendPasswordChangedEmail({ to: `user${i}@example.com`, name: null });
    }

    expect(getConsoleMailLog().length).toBeLessThanOrEqual(200);
  });
});
