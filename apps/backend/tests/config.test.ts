import { describe, it, expect } from 'vitest';
import { detectStage } from '../src/config/stage';
import { detectModes } from '../src/config/modes';
import { getStageDefaults } from '../src/config/defaults';
import { loadConfig } from '../src/config/configLoader';
import { ConfigValidationError, GovernmentModeComplianceError } from '../src/config/errors';
import { assertGovernmentModeCompliance } from '../src/config/governmentCompliance';
import { SecretsManager } from '../src/secrets/secretsManager';
import { ISecretSource } from '../src/secrets/interfaces/secretSource';
import { LoggerAuditLog } from '../src/secrets/audit/loggerAuditLog';
import { IHsmProvider } from '../src/secrets/interfaces/hsm';
import { AppConfig } from '../src/config/types';

class InMemorySource implements ISecretSource {
  readonly kind = 'env' as const;
  constructor(private readonly values: Record<string, string>) {}
  isAvailable(): boolean {
    return true;
  }
  async read(key: string): Promise<string | undefined> {
    return this.values[key];
  }
}

function testSecretsManager(values: Record<string, string> = {}) {
  return new SecretsManager({
    environment: 'testing',
    sources: [new InMemorySource(values)],
    auditLog: new LoggerAuditLog(),
  });
}

describe('detectStage', () => {
  it('prefers APP_STAGE over NODE_ENV', () => {
    expect(detectStage({ APP_STAGE: 'qa', NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('qa');
  });

  it('falls back to NODE_ENV=production', () => {
    expect(detectStage({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('production');
  });

  it('falls back to NODE_ENV=test -> testing', () => {
    expect(detectStage({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe('testing');
  });

  it('defaults to development when nothing is set', () => {
    expect(detectStage({} as NodeJS.ProcessEnv)).toBe('development');
  });

  it('ignores an invalid APP_STAGE value and falls through', () => {
    expect(detectStage({ APP_STAGE: 'nonsense', NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('production');
  });
});

describe('detectModes', () => {
  it('reads discrete boolean flags', () => {
    const modes = detectModes({ MOCK_MODE: 'true', GOVERNMENT_MODE: '1' } as NodeJS.ProcessEnv);
    expect(modes.mock).toBe(true);
    expect(modes.government).toBe(true);
    expect(modes.offline).toBe(false);
  });

  it('unions in APP_MODES CSV values', () => {
    const modes = detectModes({ APP_MODES: 'offline, self-hosted' } as NodeJS.ProcessEnv);
    expect(modes.offline).toBe(true);
    expect(modes.selfHosted).toBe(true);
    expect(modes.mock).toBe(false);
  });

  it('combines discrete flags and APP_MODES without conflict', () => {
    const modes = detectModes({ MOCK_MODE: 'true', APP_MODES: 'enterprise' } as NodeJS.ProcessEnv);
    expect(modes.mock).toBe(true);
    expect(modes.enterprise).toBe(true);
  });

  it('all default to false with no env set', () => {
    const modes = detectModes({} as NodeJS.ProcessEnv);
    expect(Object.values(modes).every((v) => v === false)).toBe(true);
  });
});

describe('getStageDefaults', () => {
  const noModes = { offline: false, mock: false, enterprise: false, government: false, selfHosted: false };

  it('gives development a debug log level', () => {
    expect(getStageDefaults('development', noModes).logging.level).toBe('debug');
  });

  it('gives production a stricter rate limit than development', () => {
    const dev = getStageDefaults('development', noModes);
    const prod = getStageDefaults('production', noModes);
    expect(prod.rateLimit.maxRequests).toBeLessThan(dev.rateLimit.maxRequests);
  });

  it('enterprise mode tightens the rate limit further, on top of any stage', () => {
    const plain = getStageDefaults('production', noModes);
    const enterprise = getStageDefaults('production', { ...noModes, enterprise: true });
    expect(enterprise.rateLimit.maxRequests).toBeLessThanOrEqual(plain.rateLimit.maxRequests);
  });
});

describe('loadConfig', () => {
  it('produces a fully-typed config using stage defaults when no env overrides are set', async () => {
    const secrets = testSecretsManager({ DATABASE_URL: 'postgresql://test' });
    const config = await loadConfig({ APP_STAGE: 'testing' } as NodeJS.ProcessEnv, secrets);

    expect(config.stage).toBe('testing');
    expect(config.database.url).toBe('postgresql://test');
    expect(config.server.port).toBeGreaterThan(0);
    expect(config.providers.openaiEnabled).toBe(false);
  });

  it('respects explicit env var overrides over stage defaults', async () => {
    const secrets = testSecretsManager({ DATABASE_URL: 'postgresql://test' });
    const config = await loadConfig(
      { APP_STAGE: 'testing', PORT: '4000', CORS_ORIGINS: 'https://a.example.com,https://b.example.com' } as NodeJS.ProcessEnv,
      secrets
    );

    expect(config.server.port).toBe(4000);
    expect(config.server.corsOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('flags a provider as enabled once its key resolves through SecretsManager', async () => {
    const secrets = testSecretsManager({ DATABASE_URL: 'postgresql://test', OPENAI_API_KEY: 'sk-test' });
    const config = await loadConfig({ APP_STAGE: 'testing' } as NodeJS.ProcessEnv, secrets);

    expect(config.providers.openaiEnabled).toBe(true);
    expect(config.providers.anthropicEnabled).toBe(false);
  });

  it('throws ConfigValidationError with every violation when the shape is invalid', async () => {
    const secrets = testSecretsManager({ DATABASE_URL: 'postgresql://test' });

    await expect(
      loadConfig({ APP_STAGE: 'testing', PORT: '-5', CORS_ORIGINS: 'not-a-url' } as NodeJS.ProcessEnv, secrets)
    ).rejects.toThrow(ConfigValidationError);
  });

  it('is type-safe: config.stage narrows to the DeploymentStage union at compile time', async () => {
    const secrets = testSecretsManager({ DATABASE_URL: 'postgresql://test' });
    const config: AppConfig = await loadConfig({ APP_STAGE: 'qa' } as NodeJS.ProcessEnv, secrets);
    // This assignment only compiles if `stage` really is the narrow union,
    // not a plain string — a type regression here would fail `tsc`.
    const stage: 'development' | 'testing' | 'qa' | 'staging' | 'production' = config.stage;
    expect(stage).toBe('qa');
  });
});

describe('assertGovernmentModeCompliance', () => {
  const availableHsm: IHsmProvider = {
    available: true,
    encrypt: async (b) => b,
    decrypt: async (b) => b,
    sign: async (b) => b,
    getPublicKey: async () => Buffer.from(''),
  };
  const unavailableHsm: IHsmProvider = {
    available: false,
    encrypt: async () => {
      throw new Error('not configured');
    },
    decrypt: async () => {
      throw new Error('not configured');
    },
    sign: async () => {
      throw new Error('not configured');
    },
    getPublicKey: async () => {
      throw new Error('not configured');
    },
  };

  function configWith(government: boolean): AppConfig {
    return {
      stage: 'production',
      modes: { offline: false, mock: false, enterprise: false, government, selfHosted: false },
      server: { port: 3001, corsOrigins: ['http://localhost:3000'] },
      rateLimit: { windowMs: 1000, maxRequests: 10 },
      logging: { level: 'info' },
      auth: { jwtExpiry: '15m', jwtRefreshExpiry: '7d' },
      urls: { backendUrl: 'http://localhost:3001', frontendUrl: 'http://localhost:3000' },
      database: { url: 'postgresql://test' },
      providers: { openaiEnabled: false, anthropicEnabled: false, replicateEnabled: false },
    };
  }

  it('does nothing when government mode is off, regardless of HSM availability', () => {
    expect(() => assertGovernmentModeCompliance(configWith(false), unavailableHsm)).not.toThrow();
  });

  it('throws when government mode is on but no HSM is configured', () => {
    expect(() => assertGovernmentModeCompliance(configWith(true), unavailableHsm)).toThrow(
      GovernmentModeComplianceError
    );
  });

  it('passes when government mode is on and a real HSM is configured', () => {
    expect(() => assertGovernmentModeCompliance(configWith(true), availableHsm)).not.toThrow();
  });
});
