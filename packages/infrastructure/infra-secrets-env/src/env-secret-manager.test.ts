import { describe, expect, it } from 'vitest';
import { EnvSecretManager } from './env-secret-manager.js';

describe('EnvSecretManager', () => {
  it('resolves a secret from the injected env record', async () => {
    const manager = new EnvSecretManager({ OPENROUTER_API_KEY: 'sk-test' });
    expect(await manager.getSecret('OPENROUTER_API_KEY')).toBe('sk-test');
  });

  it('returns undefined for a missing key', async () => {
    const manager = new EnvSecretManager({});
    expect(await manager.getSecret('MISSING')).toBeUndefined();
  });
});
