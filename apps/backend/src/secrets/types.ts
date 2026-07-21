/**
 * Core vocabulary for the secrets subsystem. Nothing in this file talks to
 * a real secret store — that lives in sources/. Keeping the types isolated
 * means every consumer (SecretsManager, audit log, catalog) agrees on the
 * same shape regardless of where a secret's value actually comes from.
 */

// Type-only: the canonical DeploymentStage lives in ../config/types and is
// owned by the Environment Management System. This is a compile-time-only
// reference (`import type`), so it does not create a runtime dependency —
// config/configLoader.ts separately depends on secrets at runtime to
// resolve secret-backed fields like DATABASE_URL, and that one-directional
// runtime edge (config -> secrets) is intentional.
import type { DeploymentStage } from '../config/types';

export type SecretEnvironment = DeploymentStage;

/**
 * Where a secret's value was actually read from. Distinct from
 * SecretEnvironment (which deployment stage we're in) — e.g. CI/CD,
 * Vercel, Netlify and GitHub Actions are all "env var" mechanically, but
 * are tracked separately so audit logs and incident response can tell them
 * apart.
 */
export type SecretSourceKind =
  | 'placeholder'
  | 'env'
  | 'docker'
  | 'kubernetes'
  | 'ci'
  | 'vercel'
  | 'netlify'
  | 'github-actions'
  | 'hsm';

export interface SecretMetadata {
  key: string;
  version: number;
  source: SecretSourceKind;
  createdAt: Date;
  rotatedAt?: Date;
  expiresAt?: Date;
  isPlaceholder: boolean;
}

/** A resolved secret. Never log or serialize this whole; log SecretMetadata instead. */
export interface SecretRecord extends SecretMetadata {
  value: string;
}

/**
 * Declarative entry in the secret catalog (registry.ts). This is the
 * single source of truth for "what secrets exist, who owns them, where
 * they're required, and how often they should rotate" — independent of
 * where any individual environment happens to source the value from.
 */
export interface SecretDescriptor {
  key: string;
  description: string;
  owner: string;
  environments: SecretEnvironment[];
  /** Environments where a missing value should hard-fail startup. */
  requiredIn: SecretEnvironment[];
  /** Recommended rotation cadence; undefined means "no policy yet". */
  rotationDays?: number;
}
