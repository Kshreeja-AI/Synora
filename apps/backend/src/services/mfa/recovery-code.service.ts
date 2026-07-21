import crypto from 'crypto';

/**
 * Recovery Code Service
 * Generates and manages one-time backup codes for MFA recovery
 */
export class RecoveryCodeService {
  private static readonly CODE_LENGTH = 8;
  private static readonly CODE_COUNT = 10;
  private static readonly CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  /**
   * Generate recovery codes
   * Format: XXXX-XXXX (8 alphanumeric characters with dash)
   * Entropy: ~42 bits per code (5.3 bits per char × 8 chars)
   * Returns: [code, codeHash] pairs
   */
  static generateCodes(count: number = this.CODE_COUNT): string[] {
    const codes: string[] = [];

    for (let i = 0; i < count; i++) {
      const code = this.generateSingleCode();
      codes.push(code);
    }

    return codes;
  }

  /**
   * Generate single recovery code
   * Format: XXXX-XXXX
   */
  private static generateSingleCode(): string {
    let code = '';

    for (let i = 0; i < this.CODE_LENGTH; i++) {
      const randomIndex = crypto.randomInt(0, this.CHARS.length);
      code += this.CHARS[randomIndex];
    }

    // Add dash in middle
    return `${code.substring(0, 4)}-${code.substring(4)}`;
  }

  /**
   * Hash recovery code for storage
   * Uses SHA-256 so original code is never stored
   */
  static hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  /**
   * Verify recovery code
   * Uses timing-safe comparison to prevent timing attacks
   */
  static verifyCode(code: string, hash: string): boolean {
    const providedHash = this.hashCode(code);

    try {
      return crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(hash));
    } catch {
      return false;
    }
  }

  /**
   * Validate recovery code format
   * Expected: XXXX-XXXX (alphanumeric + dash)
   */
  static isValidFormat(code: string): boolean {
    return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.toUpperCase());
  }

  /**
   * Generate hashes for storage
   * Returns: [code, hash] pairs for database insertion
   */
  static generateCodeHashPairs(count: number = this.CODE_COUNT): Array<{ code: string; hash: string }> {
    const codes = this.generateCodes(count);
    return codes.map((code) => ({
      code,
      hash: this.hashCode(code),
    }));
  }
}
