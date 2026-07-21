import { z } from 'zod';
import { AppConfigSchema, DeploymentStageSchema, OperatingModeSchema } from './schema';

/**
 * Two orthogonal axes, not one flat list:
 *
 * - DeploymentStage: which lifecycle stage this process is running as.
 *   Exactly one at a time.
 * - OperatingMode: behavioral toggles that can apply *within* any stage —
 *   a "staging" deployment can also be in "mock" mode for a QA demo, or a
 *   "production" deployment can also be "self-hosted" and "government".
 *   Zero or more at once.
 *
 * Modeling "Production" and "Mock Mode" as one enum would make
 * "production QA demo running against mocked providers" inexpressible.
 * This split is the whole point of the design.
 */
export type DeploymentStage = z.infer<typeof DeploymentStageSchema>;
export type OperatingMode = z.infer<typeof OperatingModeSchema>;

export interface OperatingModeFlags {
  offline: boolean;
  mock: boolean;
  enterprise: boolean;
  government: boolean;
  selfHosted: boolean;
}

export type AppConfig = z.infer<typeof AppConfigSchema>;
