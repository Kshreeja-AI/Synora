export class SecretNotFoundError extends Error {
  constructor(key: string, environment: string) {
    super(`Secret "${key}" was not found in any configured source for environment "${environment}".`);
    this.name = 'SecretNotFoundError';
  }
}

export class SecretsValidationError extends Error {
  constructor(missingKeys: string[], environment: string) {
    super(
      `Missing or not-production-grade required secret(s) for environment "${environment}": ${missingKeys.join(', ')}. ` +
        'See docs/security/SECRET_MANAGEMENT.md for how to configure them.'
    );
    this.name = 'SecretsValidationError';
  }
}
