import { ISecretSource } from '../interfaces/secretSource';
import { SecretSourceKind } from '../types';

/**
 * Reads process.env. This is mechanically the only thing CI/CD, GitHub
 * Actions, Vercel and Netlify secrets actually are at runtime — each of
 * those platforms' "secret" concept is just an env var injected before
 * the process starts. What differs between them is *how you configure*
 * the value (their dashboards/CLIs), not how the app reads it — see
 * docs/security/SECRET_MANAGEMENT.md for the per-platform setup steps.
 *
 * `detectPlatform()` labels which of those injected the current env, so
 * audit events say "read via vercel" instead of a generic "env".
 */
export class EnvVarSecretSource implements ISecretSource {
  readonly kind: SecretSourceKind;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    kind?: SecretSourceKind
  ) {
    this.kind = kind ?? EnvVarSecretSource.detectPlatform(env);
  }

  static detectPlatform(env: NodeJS.ProcessEnv = process.env): SecretSourceKind {
    if (env.VERCEL) return 'vercel';
    if (env.NETLIFY) return 'netlify';
    if (env.GITHUB_ACTIONS) return 'github-actions';
    if (env.CI) return 'ci';
    return 'env';
  }

  isAvailable(): boolean {
    return true;
  }

  async read(key: string): Promise<string | undefined> {
    const value = this.env[key];
    return value === '' ? undefined : value;
  }
}
