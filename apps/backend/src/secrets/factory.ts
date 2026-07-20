import { SecretsManager } from './secretsManager';
import { LoggerAuditLog } from './audit/loggerAuditLog';
import { EnvVarSecretSource } from './sources/envVarSource';
import { DockerSecretSource } from './sources/dockerSecretSource';
import { KubernetesSecretSource } from './sources/kubernetesSecretSource';
import { PlaceholderSecretSource } from './sources/placeholderSource';
import { SECRET_CATALOG } from './registry';
import { SecretEnvironment } from './types';

export function detectEnvironment(env: NodeJS.ProcessEnv = process.env): SecretEnvironment {
  const explicit = env.APP_ENV?.toLowerCase();
  if (explicit === 'production' || explicit === 'staging' || explicit === 'development' || explicit === 'local') {
    return explicit;
  }

  const nodeEnv = env.NODE_ENV?.toLowerCase();
  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'staging') return 'staging';
  if (nodeEnv === 'development') return 'development';
  return 'local';
}

/**
 * Wires the source precedence chain for a given environment.
 *
 * local/development: env vars win if set, otherwise fall back to
 * deterministic placeholders — the app always boots, no real secrets
 * required.
 *
 * staging/production: Kubernetes and Docker file-mounted secrets are
 * checked first (the expected mechanism in those environments), then
 * plain env vars (covers Vercel/Netlify/CI-injected values). The
 * placeholder source is deliberately never included here — a missing
 * required secret must fail loudly, not silently serve a fake value.
 */
export function createSourceChain(environment: SecretEnvironment, env: NodeJS.ProcessEnv = process.env) {
  if (environment === 'local' || environment === 'development') {
    return [new EnvVarSecretSource(env), new PlaceholderSecretSource()];
  }

  return [new KubernetesSecretSource(undefined, env), new DockerSecretSource(), new EnvVarSecretSource(env)];
}

export function createDefaultSecretsManager(env: NodeJS.ProcessEnv = process.env): SecretsManager {
  const environment = detectEnvironment(env);

  return new SecretsManager({
    environment,
    sources: createSourceChain(environment, env),
    auditLog: new LoggerAuditLog(),
    catalog: SECRET_CATALOG,
    actor: 'backend',
  });
}
