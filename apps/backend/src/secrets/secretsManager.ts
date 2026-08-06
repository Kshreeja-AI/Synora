import { assertServerOnly } from './serverOnly';
import { ISecretSource } from './interfaces/secretSource';
import { ISecretAuditLog } from './interfaces/auditLog';
import { SecretDescriptor, SecretEnvironment, SecretMetadata, SecretRecord } from './types';
import { SecretNotFoundError, SecretsValidationError } from './errors';
import { PlaceholderSecretSource } from './sources/placeholderSource';

export interface SecretsManagerOptions {
  environment: SecretEnvironment;
  /** Precedence order — first source that both isAvailable() and returns a value wins. */
  sources: ISecretSource[];
  auditLog: ISecretAuditLog;
  catalog?: SecretDescriptor[];
  /** Default actor label attached to audit events, e.g. "backend". */
  actor?: string;
}

/**
 * The single entry point business logic should use to read a secret.
 * Owns version history, rotation, expiration and auditing; delegates
 * "where does the raw value come from" to the configured ISecretSource
 * chain, so callers never know or care whether they're running in Docker,
 * Kubernetes, Vercel, or against a plain .env file.
 */
export class SecretsManager {
  private readonly environment: SecretEnvironment;
  private readonly sources: ISecretSource[];
  private readonly auditLog: ISecretAuditLog;
  private readonly catalog: Map<string, SecretDescriptor>;
  private readonly defaultActor: string;
  private readonly versions = new Map<string, SecretRecord[]>();

  constructor(options: SecretsManagerOptions) {
    assertServerOnly();
    this.environment = options.environment;
    this.sources = options.sources;
    this.auditLog = options.auditLog;
    this.catalog = new Map((options.catalog ?? []).map((d) => [d.key, d]));
    this.defaultActor = options.actor ?? 'backend';
  }

  getEnvironment(): SecretEnvironment {
    return this.environment;
  }

  /** Throws SecretNotFoundError if no source has a value for this key. */
  async get(key: string, actor?: string): Promise<string> {
    const record = await this.tryGetRecord(key, actor);
    if (!record) {
      throw new SecretNotFoundError(key, this.environment);
    }
    return record.value;
  }

  /** Same as get(), but resolves to undefined instead of throwing. */
  async tryGet(key: string, actor?: string): Promise<string | undefined> {
    const record = await this.tryGetRecord(key, actor);
    return record?.value;
  }

  /**
   * Like tryGet(), but a generated placeholder resolves to undefined.
   *
   * Two different questions hide inside "does this secret exist". For
   * INTERNAL secrets — JWT_SECRET, DATABASE_URL — a deterministic
   * placeholder is genuinely useful: sign and verify agree with each
   * other, and development boots with zero configuration. tryGet()
   * answers that question. For EXTERNAL credentials — API keys, SMTP
   * passwords — the other side of the wire has never heard of our
   * placeholder, so "a value resolves" and "we can authenticate" are
   * different claims. A provider that treats the first as the second
   * selects itself, calls a real vendor with `placeholder_…`, and turns
   * an honest "not configured" into a misleading auth failure. Every
   * isConfigured() must ask THIS question, never tryGet()'s.
   *
   * The declined read still lands in the audit log as
   * `access-placeholder`, so "why does this provider say unconfigured?"
   * is answerable from the trail.
   */
  async tryGetReal(key: string, actor?: string): Promise<string | undefined> {
    const record = await this.tryGetRecord(key, actor);
    if (!record || record.isPlaceholder) return undefined;
    return record.value;
  }

  /** True only when a real (non-placeholder) value resolves for this key. */
  async hasReal(key: string, actor?: string): Promise<boolean> {
    return (await this.tryGetReal(key, actor)) !== undefined;
  }

  /**
   * Replaces a secret's current value with a caller-supplied one and
   * bumps its version, preserving prior versions in history. This is the
   * primitive a rotation job (manual or scheduled) calls; SecretsManager
   * itself has no scheduler — see docs/security/SECRET_MANAGEMENT.md#rotation.
   */
  async rotate(key: string, newValue: string, actor?: string): Promise<SecretRecord> {
    const history = this.versions.get(key) ?? [];
    const previous = history[history.length - 1];

    if (previous) {
      previous.rotatedAt = new Date();
    }

    const descriptor = this.catalog.get(key);
    const record: SecretRecord = {
      key,
      value: newValue,
      version: (previous?.version ?? 0) + 1,
      source: previous?.source ?? 'env',
      createdAt: new Date(),
      expiresAt: descriptor?.rotationDays
        ? daysFromNow(descriptor.rotationDays)
        : undefined,
      isPlaceholder: false,
    };

    history.push(record);
    this.versions.set(key, history);

    this.auditLog.record({
      timestamp: new Date(),
      key,
      action: 'rotate',
      source: record.source,
      version: record.version,
      actor: actor ?? this.defaultActor,
    });

    return record;
  }

  /**
   * Full version history for a key, oldest first. Use this for grace-period
   * verification during rotation — e.g. a JWT should still validate against
   * the previous signing key for a window after rotation.
   */
  getVersions(key: string): readonly SecretRecord[] {
    return this.versions.get(key) ?? [];
  }

  getMetadata(key: string): SecretMetadata | undefined {
    const history = this.versions.get(key);
    const current = history?.[history.length - 1];
    if (!current) return undefined;
    const { value: _value, ...metadata } = current;
    return metadata;
  }

  isExpired(key: string): boolean {
    const meta = this.getMetadata(key);
    if (!meta?.expiresAt) return false;
    return meta.expiresAt.getTime() < Date.now();
  }

  /**
   * Startup validation: for every catalog entry required in the current
   * environment, confirm a value resolves. Call this once during app boot.
   * Throws SecretsValidationError (fail-fast) in staging/production;
   * development/testing/qa only warn — matching which stages get the
   * placeholder fallback (see factory.ts#createSourceChain), so "use
   * placeholders during development" holds for all three non-hard-fail
   * stages, not just development.
   */
  async validateRequired(): Promise<void> {
    const missing: string[] = [];

    for (const descriptor of this.catalog.values()) {
      if (!descriptor.requiredIn.includes(this.environment)) continue;
      const value = await this.tryGet(descriptor.key, 'startup-validation');
      if (value === undefined) {
        missing.push(descriptor.key);
      }
    }

    if (missing.length === 0) return;

    const softFailStages: readonly string[] = ['development', 'testing', 'qa'];
    if (softFailStages.includes(this.environment)) {
      for (const key of missing) {
        this.auditLog.record({
          timestamp: new Date(),
          key,
          action: 'access-denied',
          source: 'placeholder',
          actor: 'startup-validation',
          metadata: { reason: 'missing-in-non-production-non-fatal' },
        });
      }
      return;
    }

    throw new SecretsValidationError(missing, this.environment);
  }

  private currentVersion(key: string): SecretRecord | undefined {
    const history = this.versions.get(key);
    return history?.[history.length - 1];
  }

  private async tryGetRecord(key: string, actor?: string): Promise<SecretRecord | undefined> {
    const resolvedActor = actor ?? this.defaultActor;
    let record = this.currentVersion(key);

    if (!record) {
      record = await this.resolveFromSources(key);
      if (record) {
        this.versions.set(key, [record]);
      }
    }

    if (!record) {
      return undefined;
    }

    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      this.auditLog.record({
        timestamp: new Date(),
        key,
        action: 'access-expired',
        source: record.source,
        version: record.version,
        actor: resolvedActor,
      });
    } else if (record.isPlaceholder) {
      this.auditLog.record({
        timestamp: new Date(),
        key,
        action: 'access-placeholder',
        source: record.source,
        version: record.version,
        actor: resolvedActor,
      });
    } else {
      this.auditLog.record({
        timestamp: new Date(),
        key,
        action: 'read',
        source: record.source,
        version: record.version,
        actor: resolvedActor,
      });
    }

    return record;
  }

  private async resolveFromSources(key: string): Promise<SecretRecord | undefined> {
    const descriptor = this.catalog.get(key);

    for (const source of this.sources) {
      if (!source.isAvailable()) continue;
      const value = await source.read(key);
      if (value === undefined) continue;

      return {
        key,
        value,
        version: 1,
        source: source.kind,
        createdAt: new Date(),
        expiresAt: descriptor?.rotationDays ? daysFromNow(descriptor.rotationDays) : undefined,
        isPlaceholder: source instanceof PlaceholderSecretSource,
      };
    }

    return undefined;
  }
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
