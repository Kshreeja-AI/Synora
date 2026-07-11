import type { SecretManager } from '@synora/config';

export class EnvSecretManager implements SecretManager {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async getSecret(key: string): Promise<string | undefined> {
    return this.env[key];
  }
}
