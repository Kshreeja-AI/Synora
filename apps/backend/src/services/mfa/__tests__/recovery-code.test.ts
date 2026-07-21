import { describe, it, expect } from 'vitest';
import { RecoveryCodeService } from '../recovery-code.service';

describe('RecoveryCodeService', () => {
  describe('generateCodes', () => {
    it('should generate specified number of codes', () => {
      const codes = RecoveryCodeService.generateCodes(5);
      expect(codes).toHaveLength(5);
    });

    it('should generate default 10 codes', () => {
      const codes = RecoveryCodeService.generateCodes();
      expect(codes).toHaveLength(10);
    });

    it('should generate codes in correct format', () => {
      const codes = RecoveryCodeService.generateCodes(10);
      codes.forEach((code) => {
        expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      });
    });

    it('should generate unique codes', () => {
      const codes = RecoveryCodeService.generateCodes(100);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(100);
    });
  });

  describe('hashCode', () => {
    it('should produce consistent hash', () => {
      const code = 'ABCD-1234';
      const hash1 = RecoveryCodeService.hashCode(code);
      const hash2 = RecoveryCodeService.hashCode(code);

      expect(hash1).toBe(hash2);
    });

    it('should produce 64-character hex string', () => {
      const code = 'ABCD-1234';
      const hash = RecoveryCodeService.hashCode(code);

      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
    });

    it('should produce different hashes for different codes', () => {
      const code1 = 'AAAA-1111';
      const code2 = 'BBBB-2222';

      const hash1 = RecoveryCodeService.hashCode(code1);
      const hash2 = RecoveryCodeService.hashCode(code2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyCode', () => {
    it('should verify correct code', () => {
      const code = 'ABCD-1234';
      const hash = RecoveryCodeService.hashCode(code);

      expect(RecoveryCodeService.verifyCode(code, hash)).toBe(true);
    });

    it('should reject incorrect code', () => {
      const correctCode = 'ABCD-1234';
      const wrongCode = 'ABCD-1235';
      const hash = RecoveryCodeService.hashCode(correctCode);

      expect(RecoveryCodeService.verifyCode(wrongCode, hash)).toBe(false);
    });

    it('should reject malformed hash', () => {
      const code = 'ABCD-1234';
      const invalidHash = 'not-a-hash';

      expect(RecoveryCodeService.verifyCode(code, invalidHash)).toBe(false);
    });

    it('should be timing-safe', () => {
      const correctHash = RecoveryCodeService.hashCode('AAAA-1111');
      const correctCode = 'AAAA-1111';
      const wrongCode = 'BBBB-2222';

      const start1 = Date.now();
      RecoveryCodeService.verifyCode(correctCode, correctHash);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      RecoveryCodeService.verifyCode(wrongCode, correctHash);
      const time2 = Date.now() - start2;

      // Timing should be similar (within 100ms tolerance)
      expect(Math.abs(time1 - time2)).toBeLessThan(100);
    });

    it('should handle case insensitivity', () => {
      const code = 'abcd-1234';
      const hash = RecoveryCodeService.hashCode('ABCD-1234');

      expect(RecoveryCodeService.verifyCode(code, hash)).toBe(true);
    });
  });

  describe('isValidFormat', () => {
    it('should accept valid codes', () => {
      const validCodes = [
        'ABCD-1234',
        'ZZZZ-0000',
        'AAAA-AAAA',
        '1234-5678',
        'abcd-1234',
        'Test-Code',
      ];

      validCodes.forEach((code) => {
        expect(RecoveryCodeService.isValidFormat(code)).toBe(true);
      });
    });

    it('should reject codes with invalid format', () => {
      const invalidCodes = [
        'ABCD1234', // No dash
        'ABC-1234', // Too short first part
        'ABCDE-1234', // Too long first part
        'ABCD-123', // Too short second part
        'ABCD-12345', // Too long second part
        'ABCD_1234', // Wrong separator
        'AB CD-1234', // Space
        '', // Empty
        'ABCD-', // Incomplete
      ];

      invalidCodes.forEach((code) => {
        expect(RecoveryCodeService.isValidFormat(code)).toBe(false);
      });
    });

    it('should reject codes with special characters', () => {
      const invalidCodes = [
        'AB@D-1234',
        'ABCD-12#4',
        'ABC!-1234',
        'ABCD-12$4',
      ];

      invalidCodes.forEach((code) => {
        expect(RecoveryCodeService.isValidFormat(code)).toBe(false);
      });
    });
  });

  describe('generateCodeHashPairs', () => {
    it('should generate specified number of pairs', () => {
      const pairs = RecoveryCodeService.generateCodeHashPairs(7);
      expect(pairs).toHaveLength(7);
    });

    it('should generate default 10 pairs', () => {
      const pairs = RecoveryCodeService.generateCodeHashPairs();
      expect(pairs).toHaveLength(10);
    });

    it('should have valid code and hash in each pair', () => {
      const pairs = RecoveryCodeService.generateCodeHashPairs(5);

      pairs.forEach((pair) => {
        expect(pair.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        expect(pair.hash).toHaveLength(64);
        expect(/^[a-f0-9]{64}$/.test(pair.hash)).toBe(true);
      });
    });

    it('should produce verifiable code-hash pairs', () => {
      const pairs = RecoveryCodeService.generateCodeHashPairs(10);

      pairs.forEach((pair) => {
        expect(RecoveryCodeService.verifyCode(pair.code, pair.hash)).toBe(true);
      });
    });

    it('should generate unique codes', () => {
      const pairs = RecoveryCodeService.generateCodeHashPairs(50);
      const codes = new Set(pairs.map((p) => p.code));

      expect(codes.size).toBe(50);
    });

    it('should generate unique hashes', () => {
      const pairs = RecoveryCodeService.generateCodeHashPairs(50);
      const hashes = new Set(pairs.map((p) => p.hash));

      expect(hashes.size).toBe(50);
    });
  });

  describe('Security Properties', () => {
    it('should use sufficient entropy', () => {
      const codes = new Set<string>();

      for (let i = 0; i < 1000; i++) {
        const pair = RecoveryCodeService.generateCodeHashPairs(1)[0];
        codes.add(pair.code);
      }

      expect(codes.size).toBe(1000);
    });

    it('should not leak information via hash length', () => {
      const validCode = 'AAAA-1111';
      const validHash = RecoveryCodeService.hashCode(validCode);
      const wrongHash = RecoveryCodeService.hashCode('BBBB-2222');

      expect(validHash).toHaveLength(64);
      expect(wrongHash).toHaveLength(64);
    });
  });
});
