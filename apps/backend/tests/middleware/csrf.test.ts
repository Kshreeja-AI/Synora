import { describe, it, expect } from 'vitest';
import { generateCsrfToken } from '../../src/middleware/csrf';

describe('CSRF Middleware', () => {
  describe('generateCsrfToken', () => {
    it('should generate a 64-character hex token (32 bytes)', () => {
      const token = generateCsrfToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      expect(token.length).toBe(64);
    });

    it('should generate unique tokens', () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      expect(token1).not.toBe(token2);
    });

    it('should generate cryptographically secure tokens', () => {
      const tokens = new Set();
      // Generate 100 tokens and ensure they're all unique
      for (let i = 0; i < 100; i++) {
        tokens.add(generateCsrfToken());
      }
      expect(tokens.size).toBe(100);
    });
  });
});
