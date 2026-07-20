/**
 * Single point of contact between the provider layer and process.env.
 * Integrations resolve configuration through this (via SecretsManager)
 * instead of reading process.env directly.
 */
export class EnvironmentAdapter {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  get(key: string): string | undefined {
    return this.env[key];
  }

  getBoolean(key: string, defaultValue = false): boolean {
    const value = this.env[key];
    if (!value) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
  }

  isMockMode(): boolean {
    return this.getBoolean('USE_MOCK_PROVIDERS', false);
  }
}

export const environment = new EnvironmentAdapter();
