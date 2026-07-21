import { z } from 'zod';

/**
 * Aggregates every schema violation into one error instead of failing on
 * the first one — so a misconfigured deployment finds out about all of
 * its problems in a single startup attempt, not one fix-and-retry cycle
 * at a time.
 */
export class ConfigValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super(
      `Configuration failed validation:\n` +
        issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n')
    );
    this.name = 'ConfigValidationError';
  }
}

export class ConfigNotInitializedError extends Error {
  constructor() {
    super('Config accessed via getConfig() before initConfig() completed. Call initConfig() once at startup.');
    this.name = 'ConfigNotInitializedError';
  }
}

export class GovernmentModeComplianceError extends Error {
  constructor(reason: string) {
    super(`GOVERNMENT_MODE is enabled but a compliance requirement is not met: ${reason}`);
    this.name = 'GovernmentModeComplianceError';
  }
}
