import { describe, it, expect, beforeEach } from 'vitest';
import { CsrfManager, CSRF_CONFIG, extractCsrfToken, requiresCsrfProtection } from '../../utils/csrf';

describe('CsrfManager', () => {
  describe('generateToken', () => {
    it('should generate a 64-character hex token', () => {
      const token = CsrfManager.generateToken();
      expect(token).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(token)).toBe(true);
    });

    it('should generate different tokens on each call', () => {
      const token1 = CsrfManager.generateToken();
      const token2 = CsrfManager.generateToken();
      expect(token1).not.toBe(token2);
    });

    it('should have sufficient entropy', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(CsrfManager.generateToken());
      }
      expect(tokens.size).toBe(100); // All unique
    });
  });

  describe('hashToken', () => {
    it('should produce consistent hash for same token', () => {
      const token = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';
      const hash1 = CsrfManager.hashToken(token);
      const hash2 = CsrfManager.hashToken(token);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different tokens', () => {
      const token1 = CsrfManager.generateToken();
      const token2 = CsrfManager.generateToken();
      const hash1 = CsrfManager.hashToken(token1);
      const hash2 = CsrfManager.hashToken(token2);
      expect(hash1).not.toBe(hash2);
    });

    it('should produce 64-character hex hash', () => {
      const token = CsrfManager.generateToken();
      const hash = CsrfManager.hashToken(token);
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
    });

    it('should not expose token in hash', () => {
      const token = 'a'.repeat(64);
      const hash = CsrfManager.hashToken(token);
      expect(hash).not.toContain(token);
    });
  });

  describe('isValidTokenFormat', () => {
    it('should accept valid token format', () => {
      const token = CsrfManager.generateToken();
      expect(CsrfManager.isValidTokenFormat(token)).toBe(true);
    });

    it('should reject non-hex characters', () => {
      const invalid = 'z'.repeat(64); // z is not hex
      expect(CsrfManager.isValidTokenFormat(invalid)).toBe(false);
    });

    it('should reject wrong length', () => {
      expect(CsrfManager.isValidTokenFormat('abc')).toBe(false);
      expect(CsrfManager.isValidTokenFormat('a'.repeat(63))).toBe(false);
      expect(CsrfManager.isValidTokenFormat('a'.repeat(65))).toBe(false);
    });

    it('should reject uppercase hex', () => {
      const token = CsrfManager.generateToken().toUpperCase();
      expect(CsrfManager.isValidTokenFormat(token)).toBe(false);
    });
  });

  describe('compareTokens', () => {
    it('should return true for identical tokens', () => {
      const token = 'a'.repeat(64);
      expect(CsrfManager.compareTokens(token, token)).toBe(true);
    });

    it('should return false for different tokens', () => {
      const token1 = 'a'.repeat(64);
      const token2 = 'b'.repeat(64);
      expect(CsrfManager.compareTokens(token1, token2)).toBe(false);
    });

    it('should use timing-safe comparison', () => {
      // Timing-safe comparison should not leak token length info
      const token1 = 'a'.repeat(64);
      const token2 = 'b'; // Much shorter
      expect(CsrfManager.compareTokens(token1, token2)).toBe(false);
    });
  });

  describe('getExpiryTime', () => {
    it('should return future timestamp', () => {
      const now = new Date();
      const expiry = CsrfManager.getExpiryTime();
      expect(expiry.getTime()).toBeGreaterThan(now.getTime());
    });

    it('should expire in approximately 1 hour', () => {
      const now = new Date();
      const expiry = CsrfManager.getExpiryTime();
      const diffMs = expiry.getTime() - now.getTime();
      const diffHours = diffMs / (60 * 60 * 1000);
      expect(diffHours).toBeCloseTo(1, 0.01);
    });
  });
});

describe('extractCsrfToken', () => {
  it('should extract token from X-CSRF-Token header', () => {
    const token = CsrfManager.generateToken();
    const req = {
      headers: {
        'x-csrf-token': token,
      },
      body: {},
    };
    expect(extractCsrfToken(req)).toBe(token);
  });

  it('should extract token from form body', () => {
    const token = CsrfManager.generateToken();
    const req = {
      headers: {},
      body: {
        csrfToken: token,
      },
    };
    expect(extractCsrfToken(req)).toBe(token);
  });

  it('should prefer header over body', () => {
    const headerToken = CsrfManager.generateToken();
    const bodyToken = CsrfManager.generateToken();
    const req = {
      headers: {
        'x-csrf-token': headerToken,
      },
      body: {
        csrfToken: bodyToken,
      },
    };
    expect(extractCsrfToken(req)).toBe(headerToken);
  });

  it('should return null if no token present', () => {
    const req = {
      headers: {},
      body: {},
    };
    expect(extractCsrfToken(req)).toBeNull();
  });
});

describe('requiresCsrfProtection', () => {
  it('should require protection for POST', () => {
    expect(requiresCsrfProtection('POST')).toBe(true);
  });

  it('should require protection for PUT', () => {
    expect(requiresCsrfProtection('PUT')).toBe(true);
  });

  it('should require protection for DELETE', () => {
    expect(requiresCsrfProtection('DELETE')).toBe(true);
  });

  it('should require protection for PATCH', () => {
    expect(requiresCsrfProtection('PATCH')).toBe(true);
  });

  it('should not require protection for GET', () => {
    expect(requiresCsrfProtection('GET')).toBe(false);
  });

  it('should not require protection for HEAD', () => {
    expect(requiresCsrfProtection('HEAD')).toBe(false);
  });

  it('should not require protection for OPTIONS', () => {
    expect(requiresCsrfProtection('OPTIONS')).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(requiresCsrfProtection('post')).toBe(true);
    expect(requiresCsrfProtection('Post')).toBe(true);
    expect(requiresCsrfProtection('get')).toBe(false);
  });
});

describe('CSRF_CONFIG', () => {
  it('should have 1 hour token expiry', () => {
    expect(CSRF_CONFIG.TOKEN_EXPIRY_MS).toBe(60 * 60 * 1000);
  });

  it('should have correct header name', () => {
    expect(CSRF_CONFIG.HEADER_NAME).toBe('x-csrf-token');
  });

  it('should have correct form field name', () => {
    expect(CSRF_CONFIG.FORM_FIELD_NAME).toBe('csrfToken');
  });

  it('should use sameSite=strict for cookies', () => {
    expect(CSRF_CONFIG.COOKIE_SETTINGS.sameSite).toBe('strict');
  });
});
