import crypto from 'crypto';

/**
 * CSRF Token Manager
 * Handles token generation, hashing, and validation
 */
export class CsrfManager {
  /**
   * Generate a cryptographically secure CSRF token
   * Returns a 64-character hex string (256 bits of entropy)
   */
  static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash a token for database storage
   * Never store raw tokens; store hashes instead
   */
  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Validate token format (should be 64 hex chars)
   */
  static isValidTokenFormat(token: string): boolean {
    return /^[a-f0-9]{64}$/.test(token);
  }

  /**
   * Timing-safe token comparison
   * Prevents timing attacks where response time leaks token validity
   */
  static compareTokens(a: string, b: string): boolean {
    try {
      return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      // If buffers are different length, return false
      return false;
    }
  }

  /**
   * Calculate token expiry (1 hour from now)
   */
  static getExpiryTime(): Date {
    return new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  }
}

/**
 * CSRF Token Config
 */
export const CSRF_CONFIG = {
  // Token expiry time (1 hour in milliseconds)
  TOKEN_EXPIRY_MS: 60 * 60 * 1000,

  // Header name for CSRF token
  HEADER_NAME: 'x-csrf-token',

  // Form field name (fallback if header not present)
  FORM_FIELD_NAME: 'csrfToken',

  // Rate limiting: max tokens generated per minute per IP
  RATE_LIMIT_PER_MINUTE: 10,

  // Cookie settings
  COOKIE_SETTINGS: {
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false, // Token needs to be readable by JavaScript
    maxAge: 60 * 60 * 1000, // 1 hour
  },
};

/**
 * Extract CSRF token from request
 * Checks header first, then form body
 */
export function extractCsrfToken(req: any): string | null {
  // Check header first (preferred method)
  const tokenHeader = req.headers[CSRF_CONFIG.HEADER_NAME];
  if (tokenHeader && typeof tokenHeader === 'string') {
    return tokenHeader;
  }

  // Fallback to form body
  if (req.body && typeof req.body === 'object') {
    const tokenBody = req.body[CSRF_CONFIG.FORM_FIELD_NAME];
    if (tokenBody && typeof tokenBody === 'string') {
      return tokenBody;
    }
  }

  return null;
}

/**
 * Check if request method requires CSRF protection
 * Only protect state-changing methods
 */
export function requiresCsrfProtection(method: string): boolean {
  return ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase());
}
