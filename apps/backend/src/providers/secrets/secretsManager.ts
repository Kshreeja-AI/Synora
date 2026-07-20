import { environment, EnvironmentAdapter } from '../environment/environmentAdapter';

/**
 * Resolves provider credentials without provider code touching process.env
 * directly. Preserves the historical precedence: an explicitly-passed value
 * wins, otherwise fall back to the named environment variable, otherwise ''.
 */
export class SecretsManager {
  constructor(private readonly env: EnvironmentAdapter = environment) {}

  resolve(explicitValue: string | undefined, envVar: string): string {
    return explicitValue || this.env.get(envVar) || '';
  }
}

export const secretsManager = new SecretsManager();
