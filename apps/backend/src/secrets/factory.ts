import { SecretsManager } from './secretsManager';
import { LoggerAuditLog } from './audit/loggerAuditLog';
import { ISecretSource } from './interfaces/secretSource';
import { EnvVarSecretSource } from './sources/envVarSource';
import { DockerSecretSource } from './sources/dockerSecretSource';
import { KubernetesSecretSource } from './sources/kubernetesSecretSource';
import { PlaceholderSecretSource } from './sources/placeholderSource';
import { SECRET_CATALOG } from './registry';
import { SecretEnvironment } from './types';
import { detectStage } from '../config/stage';
import { detectModes } from '../config/modes';
import { OperatingModeFlags } from '../config/types';

/**
 * Wires the source precedence chain for a given deployment stage + mode.
 *
 * development/testing/qa: env vars win if set, otherwise fall back to
 * deterministic placeholders — these stages always boot and run with no
 * real secrets required, which is the point of testing/qa environments
 * not depending on live credentials.
 *
 * staging/production: Kubernetes and Docker file-mounted secrets are
 * checked first (the expected mechanism in those environments), then
 * plain env vars (covers Vercel/Netlify/CI-injected values). The
 * placeholder source is only added here if MOCK_MODE is explicitly on —
 * e.g. a staging deployment intentionally running a QA demo against
 * mocked providers — never as a silent default. A missing required
 * secret still fails loudly by default.
 */
export function createSourceChain(
  stage: SecretEnvironment,
  modes: OperatingModeFlags,
  env: NodeJS.ProcessEnv = process.env
) {
  const usesPlaceholders = stage === 'development' || stage === 'testing' || stage === 'qa' || modes.mock;

  if (stage === 'staging' || stage === 'production') {
    const sources: ISecretSource[] = [
      new KubernetesSecretSource(undefined, env),
      new DockerSecretSource(),
      new EnvVarSecretSource(env),
    ];
    if (usesPlaceholders) {
      sources.push(new PlaceholderSecretSource());
    }
    return sources;
  }

  const sources: ISecretSource[] = [new EnvVarSecretSource(env), new PlaceholderSecretSource()];
  return sources;
}

export function createDefaultSecretsManager(env: NodeJS.ProcessEnv = process.env): SecretsManager {
  const stage = detectStage(env);
  const modes = detectModes(env);

  return new SecretsManager({
    environment: stage,
    sources: createSourceChain(stage, modes, env),
    auditLog: new LoggerAuditLog(),
    catalog: SECRET_CATALOG,
    actor: 'backend',
  });
}
