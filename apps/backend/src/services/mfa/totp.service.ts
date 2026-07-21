import crypto from 'crypto';

/**
 * TOTP Service - RFC 6238 compliant Time-based One-Time Password
 * Uses HMAC-SHA1 with 30-second time windows
 * No external dependencies - uses only Node.js crypto
 */
export class TOTPService {
  private static readonly DIGITS = 6;
  private static readonly TIME_STEP = 30;
  private static readonly WINDOW = 1; // Accept current + previous window

  /**
   * Generate a new TOTP secret
   * Returns Base32-encoded 20-byte secret (160 bits entropy)
   */
  static generateSecret(): string {
    const secret = crypto.randomBytes(20);
    return this.toBase32(secret);
  }

  /**
   * Generate TOTP token URI for QR code
   * Format: otpauth://totp/issuer:email?secret=...
   */
  static getUri(email: string, secret: string, issuer: string = 'Synora AI'): string {
    const encoded = encodeURIComponent(issuer);
    return `otpauth://totp/${encoded}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encoded}&algorithm=SHA1&digits=6&period=30`;
  }

  /**
   * Verify a TOTP code against secret
   * Accepts codes within current window ± 1 (30-second grace period)
   * Uses timing-safe comparison to prevent timing attacks
   */
  static verify(code: string, secret: string): boolean {
    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(code)) {
      return false;
    }

    try {
      const currentTime = Math.floor(Date.now() / 1000);
      const windowSize = this.TIME_STEP;

      // Check current window and adjacent windows (±1)
      for (let i = -this.WINDOW; i <= this.WINDOW; i++) {
        const time = currentTime + i * windowSize;
        const expectedCode = this.generateCodeForTime(secret, time);

        // Timing-safe comparison
        if (this.timingSafeEqual(code, expectedCode)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Verify code and return how many windows back it was (for preventing reuse)
   * 0 = current window, -1 = previous window, etc.
   */
  static verifyWithWindow(code: string, secret: string): number | null {
    if (!/^\d{6}$/.test(code)) {
      return null;
    }

    try {
      const currentTime = Math.floor(Date.now() / 1000);
      const windowSize = this.TIME_STEP;

      for (let i = -this.WINDOW; i <= this.WINDOW; i++) {
        const time = currentTime + i * windowSize;
        const expectedCode = this.generateCodeForTime(secret, time);

        if (this.timingSafeEqual(code, expectedCode)) {
          return i;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate TOTP code for specific time (used for testing + verification)
   * Public for RFC 6238 compliance testing
   */
  static generateCodeForTime(secret: string, timestamp: number): string {
    const secretBytes = this.fromBase32(secret);
    const counter = this.getCounter(timestamp);

    // HMAC-SHA1 per RFC 4226
    const hmac = crypto.createHmac('sha1', secretBytes);
    const digest = hmac.update(counter).digest();

    // Dynamic truncation (RFC 4226 section 5.4)
    const offset = digest[digest.length - 1] & 0x0f;
    const value =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);

    const code = (value % Math.pow(10, this.DIGITS)).toString();
    return code.padStart(this.DIGITS, '0');
  }

  /**
   * Get counter value for timestamp (RFC 4226)
   * Converts to big-endian 64-bit representation
   * Public for RFC 6238 compliance testing
   */
  static getCounter(timestamp: number): Buffer {
    const counter = Buffer.alloc(8);
    const windowCount = Math.floor(timestamp / this.TIME_STEP);

    // Write big-endian 64-bit number (high byte first)
    counter.writeBigInt64BE(BigInt(windowCount), 0);

    return counter;
  }

  /**
   * Timing-safe string comparison
   * Pads both strings to same length to prevent timing leaks
   * Public for RFC 6238 compliance testing
   */
  static timingSafeEqual(a: string, b: string): boolean {
    // Pad both to same length to prevent timing oracle
    const maxLen = Math.max(a.length, b.length);
    const aPadded = a.padStart(maxLen, '\0');
    const bPadded = b.padStart(maxLen, '\0');

    try {
      return crypto.timingSafeEqual(Buffer.from(aPadded), Buffer.from(bPadded));
    } catch {
      return false;
    }
  }

  /**
   * Convert bytes to Base32 string (RFC 4648)
   * Public for RFC 6238 compliance testing
   */
  static toBase32(buffer: Buffer): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < buffer.length; i++) {
      value = (value << 8) | buffer[i];
      bits += 8;

      while (bits >= 5) {
        bits -= 5;
        output += alphabet[(value >> bits) & 31];
      }
    }

    if (bits > 0) {
      output += alphabet[(value << (5 - bits)) & 31];
    }

    // Pad with '=' to make length multiple of 8
    while (output.length % 8 !== 0) {
      output += '=';
    }

    return output;
  }

  /**
   * Convert Base32 string to bytes (RFC 4648)
   * Public for RFC 6238 compliance testing
   */
  static fromBase32(encoded: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const output: number[] = [];
    let bits = 0;
    let value = 0;

    for (const char of encoded.toUpperCase()) {
      if (char === '=') break;

      const idx = alphabet.indexOf(char);
      if (idx < 0) {
        throw new Error(`Invalid Base32 character: ${char}`);
      }

      bits += 5;
      value = (value << 5) | idx;

      if (bits >= 8) {
        bits -= 8;
        output.push((value >> bits) & 0xff);
      }
    }

    return Buffer.from(output);
  }

  /**
   * Verify a TOTP code for a specific timestamp (for testing)
   * Accepts codes within specified time ± 1 window
   */
  static verifyCodeForTime(code: string, secret: string, timestamp: number): boolean {
    if (!/^\d{6}$/.test(code)) {
      return false;
    }

    try {
      const windowSize = this.TIME_STEP;

      // Check current window and adjacent windows (±1)
      for (let i = -this.WINDOW; i <= this.WINDOW; i++) {
        const time = timestamp + i * windowSize;
        const expectedCode = this.generateCodeForTime(secret, time);

        // Timing-safe comparison
        if (this.timingSafeEqual(code, expectedCode)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate TOTP code for a specific counter value (for testing)
   */
  static generateCodeForCounter(secret: string, counter: number): string {
    const secretBytes = this.fromBase32(secret);
    const counterBuffer = Buffer.alloc(8);

    // Write big-endian 64-bit number (high byte first)
    counterBuffer.writeBigInt64BE(BigInt(counter), 0);

    // HMAC-SHA1 per RFC 4226
    const hmac = crypto.createHmac('sha1', secretBytes);
    const digest = hmac.update(counterBuffer).digest();

    // Dynamic truncation (RFC 4226 section 5.4)
    const offset = digest[digest.length - 1] & 0x0f;
    const value =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);

    const code = (value % Math.pow(10, this.DIGITS)).toString();
    return code.padStart(this.DIGITS, '0');
  }

  /**
   * Get time remaining in current window (milliseconds)
   */
  static getTimeRemaining(): number {
    const now = Date.now();
    const windowEnd = Math.ceil(now / (this.TIME_STEP * 1000)) * this.TIME_STEP * 1000;
    return windowEnd - now;
  }

  /**
   * Get current code (for testing/display)
   */
  static getCurrentCode(secret: string): string {
    return this.generateCodeForTime(secret, Math.floor(Date.now() / 1000));
  }

  /**
   * Get next code time (when code will change)
   */
  static getNextCodeTime(): Date {
    const now = Date.now();
    const nextWindow = Math.ceil(now / (this.TIME_STEP * 1000)) * this.TIME_STEP * 1000;
    return new Date(nextWindow);
  }
}
