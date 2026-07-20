import { DeploymentStage } from './types';
import { DeploymentStageSchema } from './schema';

/**
 * APP_STAGE is authoritative when set. NODE_ENV is consulted as a
 * fallback because it's what most hosting platforms (and npm/Node
 * tooling itself) set automatically — but NODE_ENV only distinguishes
 * development/production/test, so it can't express testing vs. qa vs.
 * staging on its own. Set APP_STAGE explicitly everywhere except a
 * developer's own machine.
 */
export function detectStage(env: NodeJS.ProcessEnv = process.env): DeploymentStage {
  const explicit = env.APP_STAGE?.toLowerCase();
  const parsedExplicit = DeploymentStageSchema.safeParse(explicit);
  if (parsedExplicit.success) {
    return parsedExplicit.data;
  }

  const nodeEnv = env.NODE_ENV?.toLowerCase();
  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'test') return 'testing';

  return 'development';
}
