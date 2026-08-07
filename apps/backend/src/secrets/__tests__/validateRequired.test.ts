/**
 * Boot-time secret validation — the launch gate's "env validation fails
 * closed" item, pinned at the layer that actually enforces it.
 *
 * Two claims matter and they are different: "a value resolves" and "this
 * deployment is actually secured". A production boot must refuse not only
 * a MISSING JWT_SECRET but also one copied out of this repository's test
 * setup, an unfilled <template> from .env.example, and a hand-typed short
 * string — all of which resolve, and none of which are secrets.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecretsManager } from '../secretsManager';
import { EnvVarSecretSource } from '../sources/envVarSource';
import { SecretsValidationError } from '../errors';
import { SECRET_CATALOG, KNOWN_DEV_SECRET_VALUES } from '../registry';
import type { SecretEnvironment, SecretDescriptor } from '../types';

const GOOD_SECRET = 'wJalrXUtnFEMIrealLookingGeneratedValue44char';

function manager(
  env: Record<string, string>,
  environment: SecretEnvironment = 'production',
  catalog: SecretDescriptor[] = SECRET_CATALOG
): SecretsManager {
  return new SecretsManager({
    environment,
    sources: [new EnvVarSecretSource(env, 'env')],
    auditLog: { record: vi.fn() },
    catalog,
    actor: 'validate-required-test',
  });
}

function goodProductionEnv(): Record<string, string> {
  return {
    JWT_SECRET: GOOD_SECRET,
    NEXTAUTH_SECRET: GOOD_SECRET,
    DATABASE_URL: 'postgresql://synora:realpass@db.internal:5432/synora',
    TOOL_SECRET_MASTER_KEY: GOOD_SECRET,
  };
}

describe('validateRequired', () => {
  it('passes a production boot with real-looking required secrets — and WITHOUT Stripe', async () => {
    // Payments are not in the launch scope; billing degrades honestly
    // without credentials. A production boot demanding Stripe keys would
    // block the launch for a feature it does not ship.
    await expect(manager(goodProductionEnv()).validateRequired()).resolves.toBeUndefined();
  });

  it('fails a production boot that is missing the required secrets, naming them', async () => {
    const error = await manager({}).validateRequired().then(
      () => null,
      (e: unknown) => e as SecretsValidationError
    );
    expect(error).toBeInstanceOf(SecretsValidationError);
    expect(error!.message).toContain('JWT_SECRET');
    expect(error!.message).toContain('NEXTAUTH_SECRET');
    expect(error!.message).toContain('DATABASE_URL');
    // Tools are a shipped feature — a boot without the key that encrypts
    // their stored secrets must fail HERE, not at a user's first save.
    expect(error!.message).toContain('TOOL_SECRET_MASTER_KEY');
    expect(error!.message).not.toContain('STRIPE_SECRET_KEY');
  });

  it('refuses EVERY known repo dev value as a production JWT_SECRET, without echoing it', async () => {
    // Sweep the whole denylist: each entry earned its place by actually
    // appearing in this repository (test setup, .env.example), and each
    // must individually refuse a production boot.
    for (const devValue of KNOWN_DEV_SECRET_VALUES) {
      const env = goodProductionEnv();
      env.JWT_SECRET = devValue;
      const error = await manager(env).validateRequired().then(
        () => null,
        (e: unknown) => e as SecretsValidationError
      );
      expect(error, `denylisted value not refused: ${devValue.slice(0, 12)}…`).toBeInstanceOf(
        SecretsValidationError
      );
      expect(error!.message).toContain('JWT_SECRET');
      expect(error!.message).toContain('known development value');
      // The refusal must never put the value itself into a message that
      // will be logged.
      expect(error!.message).not.toContain(devValue);
    }
  });

  it('refuses an unfilled .env.example template value', async () => {
    const env = goodProductionEnv();
    env.NEXTAUTH_SECRET = '<generate-with-openssl-rand-base64-32>';
    await expect(manager(env).validateRequired()).rejects.toThrow(/NEXTAUTH_SECRET \(present but an unfilled template/);
  });

  it('refuses a hand-typed short secret where a generated one is required', async () => {
    const env = goodProductionEnv();
    env.JWT_SECRET = 'hunter2-but-longer-still-short';
    await expect(manager(env).validateRequired()).rejects.toThrow(/JWT_SECRET \(present but shorter than the 32-character minimum/);
  });

  it('only warns, never throws, in the soft-fail stages', async () => {
    const catalog: SecretDescriptor[] = [
      {
        key: 'SOFT_STAGE_SECRET',
        description: 'required in testing, which soft-fails',
        owner: 'backend',
        environments: ['testing'],
        requiredIn: ['testing'],
      },
    ];
    const audit = vi.fn();
    const m = new SecretsManager({
      environment: 'testing',
      sources: [new EnvVarSecretSource({}, 'env')],
      auditLog: { record: audit },
      catalog,
    });
    await expect(m.validateRequired()).resolves.toBeUndefined();
    // The miss is not silent — it lands in the audit trail.
    expect(audit.mock.calls.some(([e]) => e.action === 'access-denied' && e.key === 'SOFT_STAGE_SECRET')).toBe(true);
  });
});
