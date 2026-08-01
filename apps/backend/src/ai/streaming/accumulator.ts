/**
 * Streaming chunk accumulator
 * Buffers chunks efficiently and manages partial state
 */

export class StreamingAccumulator {
  private chunks: string[] = [];
  private tokenCount = 0;
  private startTime = Date.now();
  private lastReportTime = Date.now();
  private lastReportTokens = 0;

  /**
   * Add a token chunk
   */
  addChunk(token: string): void {
    this.chunks.push(token);
    this.tokenCount++;
  }

  /**
   * Get accumulated text
   */
  getText(): string {
    return this.chunks.join('');
  }

  /**
   * Get token count
   */
  getTokenCount(): number {
    return this.tokenCount;
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get tokens per second
   */
  getTokensPerSecond(): number {
    const elapsed = this.getElapsedMs() / 1000;
    if (elapsed === 0) return 0;
    return this.tokenCount / elapsed;
  }

  /**
   * Check if should report progress
   */
  shouldReportProgress(
    tokenInterval: number = 50,
    timeInterval: number = 5000
  ): boolean {
    const tokensSinceLastReport = this.tokenCount - this.lastReportTokens;
    const timeSinceLastReport = Date.now() - this.lastReportTime;

    return tokensSinceLastReport >= tokenInterval || timeSinceLastReport >= timeInterval;
  }

  /**
   * Mark progress reported
   */
  markProgressReported(): void {
    this.lastReportTime = Date.now();
    this.lastReportTokens = this.tokenCount;
  }

  /**
   * Reset accumulator
   */
  reset(): void {
    this.chunks = [];
    this.tokenCount = 0;
    this.startTime = Date.now();
    this.lastReportTime = Date.now();
    this.lastReportTokens = 0;
  }

  /**
   * Get summary
   */
  getSummary(): {
    text: string;
    tokenCount: number;
    elapsedMs: number;
    tokensPerSecond: number;
  } {
    return {
      text: this.getText(),
      tokenCount: this.tokenCount,
      elapsedMs: this.getElapsedMs(),
      tokensPerSecond: this.getTokensPerSecond()
    };
  }
}

/**
 * Token accountant
 * Tracks input/output tokens and cost
 */
export class TokenAccountant {
  private inputTokens = 0;
  private outputTokens = 0;
  private estimatedCost = 0;
  private lastReportedAt = Date.now() - 5000;

  constructor(private model: string, private provider: string) {}

  /**
   * Set input token count
   */
  setInputTokens(count: number): void {
    this.inputTokens = count;
  }

  /**
   * Increment output tokens
   */
  incrementOutputTokens(count: number = 1): void {
    this.outputTokens += count;
  }

  /**
   * Set estimated cost in cents
   */
  setEstimatedCost(cents: number): void {
    this.estimatedCost = cents;
  }

  /**
   * Get accounting summary
   */
  getSummary() {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCostCents: this.estimatedCost,
      model: this.model,
      provider: this.provider
    };
  }

  /**
   * Check if should report progress
   */
  shouldReportProgress(interval: number = 5000): boolean {
    return Date.now() - this.lastReportedAt >= interval;
  }

  /**
   * Mark progress reported
   */
  markProgressReported(): void {
    this.lastReportedAt = Date.now();
  }
}
