import { describe, it, expect, vi } from 'vitest';
import { SecretsManager } from '../src/secrets/secretsManager';
import { ISecretSource } from '../src/secrets/interfaces/secretSource';
import { ISecretAuditLog, SecretAuditEvent } from '../src/secrets/interfaces/auditLog';
import { PlaceholderSecretSource } from '../src/secrets/sources/placeholderSource';
import { EnvVarSecretSource } from '../src/secrets/sources/envVarSource';
import { SecretNotFoundError, SecretsValidationError } from '../src/secrets/errors';
import { SecretDescriptor } from '../src/secrets/types';

class InMemorySource implements ISecretSource {
  readonly kind = 'env' as const;
  constructor(private readonly values: Record<string, string>, private available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  async read(key: string): Promise<string | undefined> {
    return this.values[key];
  }
}

class RecordingAuditLog implements ISecretAuditLog {
  events: SecretAuditEvent[] = [];
  record(event: SecretAuditEvent): void {
    this.events.push(event);
  }
}

describe('SecretsManager', () => {
  describe('source precedence', () => {
    it('uses the first available source that has the key', async () => {
      const primary = new InMemorySource({ FOO: 'primary-value' });
      const fallback = new InMemorySource({ FOO: 'fallback-value' });
      const manager = new SecretsManager({
        environment: 'local',
        sources: [primary, fallback],
        auditLog: new RecordingAuditLog(),
      });

      await expect(manager.get('FOO')).resolves.toBe('primary-value');
    });

    it('falls through to the next source when the first lacks the key', async () => {
      const primary = new InMemorySource({});
      const fallback = new InMemorySource({ FOO: 'fallback-value' });
      const manager = new SecretsManager({
        environment: 'local',
        sources: [primary, fallback],
        auditLog: new RecordingAuditLog(),
      });

      await expect(manager.get('FOO')).resolves.toBe('fallback-value');
    });

    it('skips sources that report themselves unavailable', async () => {
      const unavailable = new InMemorySource({ FOO: 'should-not-be-read' }, false);
      const available = new InMemorySource({ FOO: 'real-value' });
      const manager = new SecretsManager({
        environment: 'local',
        sources: [unavailable, available],
        auditLog: new RecordingAuditLog(),
      });

      await expect(manager.get('FOO')).resolves.toBe('real-value');
    });

    it('throws SecretNotFoundError when no source has the key', async () => {
      const manager = new SecretsManager({
        environment: 'local',
        sources: [new InMemorySource({})],
        auditLog: new RecordingAuditLog(),
      });

      await expect(manager.get('MISSING')).rejects.toThrow(SecretNotFoundError);
    });

    it('tryGet resolves to undefined instead of throwing', async () => {
      const manager = new SecretsManager({
        environment: 'local',
        sources: [new InMemorySource({})],
        auditLog: new RecordingAuditLog(),
      });

      await expect(manager.tryGet('MISSING')).resolves.toBeUndefined();
    });
  });

  describe('placeholder fallback', () => {
    it('serves a deterministic placeholder when nothing else has the key', async () => {
      const manager = new SecretsManager({
        environment: 'local',
        sources: [new InMemorySource({}), new PlaceholderSecretSource()],
        auditLog: new RecordingAuditLog(),
      });

      const value = await manager.get('SOME_SECRET');
      expect(value).toBe(PlaceholderSecretSource.generate('SOME_SECRET'));
      expect(manager.getMetadata('SOME_SECRET')?.isPlaceholder).toBe(true);
    });

    it('records an access-placeholder audit event, never the value', async () => {
      const auditLog = new RecordingAuditLog();
      const manager = new SecretsManager({
        environment: 'local',
        sources: [new PlaceholderSecretSource()],
        auditLog,
      });

      await manager.get('SOME_SECRET');
      const event = auditLog.events.find((e) => e.action === 'access-placeholder');
      expect(event).toBeDefined();
      expect(JSON.stringify(event)).not.toContain(PlaceholderSecretSource.generate('SOME_SECRET'));
    });
  });

  describe('rotation and versioning', () => {
    it('rotate() bumps the version and preserves history', async () => {
      const manager = new SecretsManager({
        environment: 'local',
        sources: [new InMemorySource({ KEY: 'v1' })],
        auditLog: new RecordingAuditLog(),
      });

      await expect(manager.get('KEY')).resolves.toBe('v1');
      const rotated = await manager.rotate('KEY', 'v2');
      expect(rotated.version).toBe(2);

      await expect(manager.get('KEY')).resolves.toBe('v2');

      const history = manager.getVersions('KEY');
      expect(history).toHaveLength(2);
      expect(history[0].value).toBe('v1');
      expect(history[0].rotatedAt).toBeInstanceOf(Date);
      expect(history[1].value).toBe('v2');
    });

    it('rotate() records a rotate audit event', async () => {
      const auditLog = new RecordingAuditLog();
      const manager = new SecretsManager({
        environment: 'local',
        sources: [new InMemorySource({ KEY: 'v1' })],
        auditLog,
      });

      await manager.get('KEY');
      await manager.rotate('KEY', 'v2');

      const rotateEvent = auditLog.events.find((e) => e.action === 'rotate');
      expect(rotateEvent).toBeDefined();
      expect(rotateEvent?.version).toBe(2);
    });
  });

  describe('expiration', () => {
    it('isExpired() is false when no rotation policy is configured', async () => {
      const manager = new SecretsManager({
        environment: 'local',
        sources: [new InMemorySource({ KEY: 'v1' })],
        auditLog: new RecordingAuditLog(),
      });

      await manager.get('KEY');
      expect(manager.isExpired('KEY')).toBe(false);
    });

    it('isExpired() is true once the rotation window has passed', async () => {
      const catalog: SecretDescriptor[] = [
        {
          key: 'KEY',
          description: 'test',
          owner: 'test',
          environments: ['local'],
          requiredIn: [],
          rotationDays: -1, // already "expired" relative to now
        },
      ];
      const manager = new SecretsManager({
        environment: 'local',
        sources: [new InMemorySource({ KEY: 'v1' })],
        auditLog: new RecordingAuditLog(),
        catalog,
      });

      await manager.get('KEY');
      expect(manager.isExpired('KEY')).toBe(true);
    });

    it('records access-expired instead of read when serving an expired secret', async () => {
      const auditLog = new RecordingAuditLog();
      const catalog: SecretDescriptor[] = [
        {
          key: 'KEY',
          description: 'test',
          owner: 'test',
          environments: ['local'],
          requiredIn: [],
          rotationDays: -1,
        },
      ];
      const manager = new SecretsManager({
        environment: 'local',
        sources: [new InMemorySource({ KEY: 'v1' })],
        auditLog,
        catalog,
      });

      await manager.get('KEY');
      expect(auditLog.events.some((e) => e.action === 'access-expired')).toBe(true);
      expect(auditLog.events.some((e) => e.action === 'read')).toBe(false);
    });
  });

  describe('validateRequired', () => {
    const catalog: SecretDescriptor[] = [
      {
        key: 'REQUIRED_KEY',
        description: 'test',
        owner: 'test',
        environments: ['local', 'production'],
        requiredIn: ['production'],
      },
    ];

    it('does not throw in local when a required-in-production secret is missing', async () => {
      const manager = new SecretsManager({
        environment: 'local',
        sources: [new InMemorySource({})],
        auditLog: new RecordingAuditLog(),
        catalog,
      });

      await expect(manager.validateRequired()).resolves.toBeUndefined();
    });

    it('throws SecretsValidationError in production when a required secret is missing', async () => {
      const manager = new SecretsManager({
        environment: 'production',
        sources: [new InMemorySource({})],
        auditLog: new RecordingAuditLog(),
        catalog,
      });

      await expect(manager.validateRequired()).rejects.toThrow(SecretsValidationError);
    });

    it('passes in production once the required secret resolves', async () => {
      const manager = new SecretsManager({
        environment: 'production',
        sources: [new InMemorySource({ REQUIRED_KEY: 'value' })],
        auditLog: new RecordingAuditLog(),
        catalog,
      });

      await expect(manager.validateRequired()).resolves.toBeUndefined();
    });
  });

  describe('server-only guard', () => {
    it('throws if constructed while `window` is defined', () => {
      (globalThis as any).window = {};
      try {
        expect(
          () =>
            new SecretsManager({
              environment: 'local',
              sources: [],
              auditLog: new RecordingAuditLog(),
            })
        ).toThrow(/must never be imported into client-side code/);
      } finally {
        delete (globalThis as any).window;
      }
    });
  });
});

describe('EnvVarSecretSource platform detection', () => {
  it('detects Vercel', () => {
    expect(EnvVarSecretSource.detectPlatform({ VERCEL: '1' } as NodeJS.ProcessEnv)).toBe('vercel');
  });

  it('detects Netlify', () => {
    expect(EnvVarSecretSource.detectPlatform({ NETLIFY: 'true' } as NodeJS.ProcessEnv)).toBe('netlify');
  });

  it('detects GitHub Actions', () => {
    expect(EnvVarSecretSource.detectPlatform({ GITHUB_ACTIONS: 'true' } as NodeJS.ProcessEnv)).toBe(
      'github-actions'
    );
  });

  it('detects generic CI', () => {
    expect(EnvVarSecretSource.detectPlatform({ CI: 'true' } as NodeJS.ProcessEnv)).toBe('ci');
  });

  it('defaults to plain env', () => {
    expect(EnvVarSecretSource.detectPlatform({} as NodeJS.ProcessEnv)).toBe('env');
  });

  it('treats empty string as unset', async () => {
    const source = new EnvVarSecretSource({ FOO: '' } as NodeJS.ProcessEnv);
    await expect(source.read('FOO')).resolves.toBeUndefined();
  });
});
