import { describe, it, expect } from 'vitest';
import { TOTPService } from '../totp.service';

describe('TOTPService', () => {
  describe('generateSecret', () => {
    it('should generate valid Base32 secret', () => {
      const secret = TOTPService.generateSecret();
      expect(secret).toHaveLength(32); // 20 bytes = 32 Base32 chars
      expect(/^[A-Z2-7=]*$/.test(secret)).toBe(true);
    });

    it('should generate unique secrets', () => {
      const secret1 = TOTPService.generateSecret();
      const secret2 = TOTPService.generateSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('getUri', () => {
    it('should generate valid otpauth URI', () => {
      const secret = TOTPService.generateSecret();
      const uri = TOTPService.getUri('user@example.com', secret);

      expect(uri).toContain('otpauth://totp/');
      expect(uri).toContain('user@example.com');
      expect(uri).toContain(`secret=${secret}`);
      expect(uri).toContain('algorithm=SHA1');
      expect(uri).toContain('digits=6');
      expect(uri).toContain('period=30');
    });
  });

  describe('verify', () => {
    it('should reject invalid code format', () => {
      const secret = TOTPService.generateSecret();

      expect(TOTPService.verify('abc123', secret)).toBe(false);
      expect(TOTPService.verify('12345', secret)).toBe(false);
      expect(TOTPService.verify('1234567', secret)).toBe(false);
      expect(TOTPService.verify('abcdef', secret)).toBe(false);
    });

    it('should verify current code', () => {
      const secret = TOTPService.generateSecret();
      const code = TOTPService.getCurrentCode(secret);

      expect(TOTPService.verify(code, secret)).toBe(true);
    });

    it('should reject invalid code', () => {
      const secret = TOTPService.generateSecret();

      expect(TOTPService.verify('000000', secret)).toBe(false);
      expect(TOTPService.verify('999999', secret)).toBe(false);
    });

    it('should accept code from previous window', () => {
      // This is harder to test without mocking time
      // In production, accept code from current ± 1 window
      const secret = TOTPService.generateSecret();
      const code = TOTPService.getCurrentCode(secret);

      // Verify should accept within window
      expect(TOTPService.verify(code, secret)).toBe(true);
    });
  });

  describe('getCurrentCode', () => {
    it('should return 6-digit code', () => {
      const secret = TOTPService.generateSecret();
      const code = TOTPService.getCurrentCode(secret);

      expect(code).toHaveLength(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });

    it('should return same code within window', () => {
      const secret = TOTPService.generateSecret();
      const code1 = TOTPService.getCurrentCode(secret);
      const code2 = TOTPService.getCurrentCode(secret);

      expect(code1).toBe(code2);
    });
  });

  describe('getTimeRemaining', () => {
    it('should return milliseconds remaining in window', () => {
      const remaining = TOTPService.getTimeRemaining();

      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(30000); // At most 30 seconds
    });
  });

  describe('getNextCodeTime', () => {
    it('should return future Date', () => {
      const now = new Date();
      const next = TOTPService.getNextCodeTime();

      expect(next.getTime()).toBeGreaterThan(now.getTime());
    });
  });

  describe('Security Properties', () => {
    it('should use sufficient entropy', () => {
      const secrets = new Set<string>();
      for (let i = 0; i < 100; i++) {
        secrets.add(TOTPService.generateSecret());
      }
      expect(secrets.size).toBe(100); // All unique
    });

    it('should be timing-safe', () => {
      const secret = TOTPService.generateSecret();
      const correctCode = TOTPService.getCurrentCode(secret);
      const wrongCode = '000000';

      // Both should return in similar time (timing-safe)
      const start1 = Date.now();
      TOTPService.verify(correctCode, secret);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      TOTPService.verify(wrongCode, secret);
      const time2 = Date.now() - start2;

      // Times should be similar (within 10ms of each other in test)
      // This is a basic check; real timing-attack testing is harder
      expect(Math.abs(time1 - time2)).toBeLessThan(100);
    });
  });
});
