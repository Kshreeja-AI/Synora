import { describe, it, expect } from '@jest/globals';
import { TOTPService } from '../totp.service';
import rfc4226Vectors from './fixtures/rfc4226-test-vectors.json';

describe('TOTPService - RFC 6238 Compliance', () => {
  describe('RFC 4226 Test Vectors (HOTP Foundation)', () => {
    const secretHex = rfc4226Vectors.secret;
    const secretBuffer = Buffer.from(secretHex, 'hex');
    const secretBase32 = TOTPService.toBase32(secretBuffer);

    it('should validate all 10 RFC 4226 test vectors', () => {
      for (const vector of rfc4226Vectors.vectors) {
        const generatedCode = TOTPService.generateCodeForCounter(secretBase32, vector.counter);
        expect(generatedCode).toBe(vector.expectedCode);
      }
    });

    it('should match RFC 4226 vector 0 (counter=0)', () => {
      const code = TOTPService.generateCodeForCounter(secretBase32, 0);
      expect(code).toBe('755224');
    });

    it('should match RFC 4226 vector 5 (counter=5)', () => {
      const code = TOTPService.generateCodeForCounter(secretBase32, 5);
      expect(code).toBe('254676');
    });

    it('should match RFC 4226 vector 9 (counter=9)', () => {
      const code = TOTPService.generateCodeForCounter(secretBase32, 9);
      expect(code).toBe('520489');
    });
  });

  describe('RFC 6238 Time-based HOTP', () => {
    const secretHex = rfc4226Vectors.secret;
    const secretBuffer = Buffer.from(secretHex, 'hex');
    const secretBase32 = TOTPService.toBase32(secretBuffer);
    const timeStep = 30; // RFC 6238 default

    it('should generate correct TOTP for epoch time 59 (counter 1)', () => {
      // Time = 59 seconds since epoch
      // Counter = floor(59 / 30) = 1
      const code = TOTPService.generateCodeForTime(secretBase32, 59, timeStep);
      expect(code).toBe('287082');
    });

    it('should generate correct TOTP for epoch time 1111111109 (counter 37037036)', () => {
      // Time = 1111111109
      // Counter = floor(1111111109 / 30) = 37037036
      // This is test case from RFC 6238 Section 4
      const code = TOTPService.generateCodeForTime(secretBase32, 1111111109, timeStep);
      expect(code).toBe('050471');
    });

    it('should generate correct TOTP for epoch time 1111111111 (counter 37037037)', () => {
      const code = TOTPService.generateCodeForTime(secretBase32, 1111111111, timeStep);
      expect(code).toBe('005924');
    });

    it('should generate correct TOTP for epoch time 1111111144 (counter 37037038)', () => {
      const code = TOTPService.generateCodeForTime(secretBase32, 1111111144, timeStep);
      expect(code).toBe('279037');
    });

    it('should generate correct TOTP for epoch time 1111111154 (counter 37037038)', () => {
      const code = TOTPService.generateCodeForTime(secretBase32, 1111111154, timeStep);
      expect(code).toBe('279037');
    });

    it('should generate correct TOTP for epoch time 1111111155 (counter 37037039)', () => {
      const code = TOTPService.generateCodeForTime(secretBase32, 1111111155, timeStep);
      expect(code).toBe('353130');
    });

    it('should generate correct TOTP for epoch time 1111111200 (counter 37037040)', () => {
      const code = TOTPService.generateCodeForTime(secretBase32, 1111111200, timeStep);
      expect(code).toBe('360365');
    });

    it('should generate correct TOTP for epoch time 1111111201 (counter 37037040)', () => {
      const code = TOTPService.generateCodeForTime(secretBase32, 1111111201, timeStep);
      expect(code).toBe('360365');
    });

    it('should generate correct TOTP for epoch time 1111111202 (counter 37037040)', () => {
      const code = TOTPService.generateCodeForTime(secretBase32, 1111111202, timeStep);
      expect(code).toBe('360365');
    });

    it('should generate correct TOTP for epoch time 1111111230 (counter 37037041)', () => {
      const code = TOTPService.generateCodeForTime(secretBase32, 1111111230, timeStep);
      expect(code).toBe('981328');
    });
  });

  describe('Time Window Tolerance (±1 window)', () => {
    const secretHex = rfc4226Vectors.secret;
    const secretBuffer = Buffer.from(secretHex, 'hex');
    const secretBase32 = TOTPService.toBase32(secretBuffer);

    it('should accept code from current time window', () => {
      const now = Math.floor(Date.now() / 1000);
      const code = TOTPService.generateCodeForTime(secretBase32, now);
      const verified = TOTPService.verifyCodeForTime(code, secretBase32, now);
      expect(verified).toBe(true);
    });

    it('should accept code from previous time window', () => {
      const now = Math.floor(Date.now() / 1000);
      const previousCode = TOTPService.generateCodeForTime(secretBase32, now - 30);
      const verified = TOTPService.verifyCodeForTime(previousCode, secretBase32, now);
      expect(verified).toBe(true);
    });

    it('should accept code from next time window', () => {
      const now = Math.floor(Date.now() / 1000);
      const nextCode = TOTPService.generateCodeForTime(secretBase32, now + 30);
      const verified = TOTPService.verifyCodeForTime(nextCode, secretBase32, now);
      expect(verified).toBe(true);
    });

    it('should reject code from window -2 (too old)', () => {
      const now = Math.floor(Date.now() / 1000);
      const oldCode = TOTPService.generateCodeForTime(secretBase32, now - 60);
      const verified = TOTPService.verifyCodeForTime(oldCode, secretBase32, now);
      expect(verified).toBe(false);
    });

    it('should reject code from window +2 (too far in future)', () => {
      const now = Math.floor(Date.now() / 1000);
      const futureCode = TOTPService.generateCodeForTime(secretBase32, now + 60);
      const verified = TOTPService.verifyCodeForTime(futureCode, secretBase32, now);
      expect(verified).toBe(false);
    });
  });

  describe('Counter Edge Cases', () => {
    const secretHex = rfc4226Vectors.secret;
    const secretBuffer = Buffer.from(secretHex, 'hex');
    const secretBase32 = TOTPService.toBase32(secretBuffer);

    it('should handle large counter values', () => {
      const largeCounter = Math.pow(2, 31) - 1; // Max 32-bit signed int
      const code = TOTPService.generateCodeForCounter(secretBase32, largeCounter);
      expect(code).toMatch(/^\d{6}$/); // Should be 6 digits
    });

    it('should handle counter overflow boundary', () => {
      // Counter near 64-bit limit
      const maxCounter = Math.pow(2, 53) - 1; // JavaScript safe integer limit
      const code = TOTPService.generateCodeForCounter(secretBase32, maxCounter);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('should produce different codes for consecutive counters', () => {
      const code1 = TOTPService.generateCodeForCounter(secretBase32, 100);
      const code2 = TOTPService.generateCodeForCounter(secretBase32, 101);
      expect(code1).not.toBe(code2);
    });
  });

  describe('Time Sync Edge Cases', () => {
    const secretHex = rfc4226Vectors.secret;
    const secretBuffer = Buffer.from(secretHex, 'hex');
    const secretBase32 = TOTPService.toBase32(secretBuffer);

    it('should handle time exactly at window boundary', () => {
      // Time that is exact multiple of 30 seconds
      const boundaryTime = 30 * 100; // 3000 seconds = 50 minutes
      const code = TOTPService.generateCodeForTime(secretBase32, boundaryTime);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('should handle time 1 second before window boundary', () => {
      const boundaryTime = 30 * 100;
      const code = TOTPService.generateCodeForTime(secretBase32, boundaryTime - 1);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('should handle time 1 second after window boundary', () => {
      const boundaryTime = 30 * 100;
      const code = TOTPService.generateCodeForTime(secretBase32, boundaryTime + 1);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('should produce same code throughout 30-second window', () => {
      const windowStart = 30 * 100;
      const code1 = TOTPService.generateCodeForTime(secretBase32, windowStart);
      const code2 = TOTPService.generateCodeForTime(secretBase32, windowStart + 15);
      const code3 = TOTPService.generateCodeForTime(secretBase32, windowStart + 29);
      expect(code1).toBe(code2);
      expect(code2).toBe(code3);
    });

    it('should produce different code in next window', () => {
      const windowStart = 30 * 100;
      const code1 = TOTPService.generateCodeForTime(secretBase32, windowStart);
      const code2 = TOTPService.generateCodeForTime(secretBase32, windowStart + 30);
      expect(code1).not.toBe(code2);
    });
  });

  describe('Secret Format Conversions', () => {
    it('should correctly convert hex to base32 and back', () => {
      const secretHex = rfc4226Vectors.secret;
      const secretBuffer = Buffer.from(secretHex, 'hex');
      const secretBase32 = TOTPService.toBase32(secretBuffer);
      const recoveredBuffer = TOTPService.fromBase32(secretBase32);
      expect(recoveredBuffer.toString('hex')).toBe(secretHex.toLowerCase());
    });

    it('should handle standard RFC 4648 base32 alphabet', () => {
      // RFC 4648 alphabet: ABCDEFGHIJKLMNOPQRSTUVWXYZ234567
      const testSecret = 'JBSWY3DPEBLW64TMMQQQ===='; // RFC example
      const buffer = TOTPService.fromBase32(testSecret);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should handle base32 padding correctly', () => {
      // Various padding scenarios
      const testCases = [
        'JBSWY3DPEBLW64TMMQQQ====', // 8 chars padding
        'JBSWY3DPEBLW64TMMQQ=====', // 7 chars padding
        'JBSWY3DPEBLW64TMMQ======', // 6 chars padding
      ];

      for (const testCase of testCases) {
        const buffer = TOTPService.fromBase32(testCase);
        expect(buffer).toBeInstanceOf(Buffer);
      }
    });
  });
});
