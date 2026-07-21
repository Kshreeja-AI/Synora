import { AppConfig } from './types';
import { loadConfig } from './configLoader';
import { ConfigNotInitializedError } from './errors';
import { assertGovernmentModeCompliance } from './governmentCompliance';
import { StubHsmProvider } from '../secrets/hsm/stubHsmProvider';
import { IHsmProvider } from '../secrets/interfaces/hsm';

export * from './types';
export * from './schema';
export * from './errors';
export { loadConfig } from './configLoader';
export { detectStage } from './stage';
export { detectModes } from './modes';
export { getStageDefaults } from './defaults';
export { assertGovernmentModeCompliance } from './governmentCompliance';

let cachedConfig: AppConfig | undefined;

/**
 * Call once at process startup (after SecretsManager.validateRequired()).
 * Everything else in the app reads config via getConfig() — this is the
 * only place config is actually assembled and validated.
 */
export async function initConfig(hsm: IHsmProvider = new StubHsmProvider()): Promise<AppConfig> {
  const config = await loadConfig();
  assertGovernmentModeCompliance(config, hsm);
  cachedConfig = config;
  return config;
}

/** Throws ConfigNotInitializedError if called before initConfig() resolves. */
export function getConfig(): AppConfig {
  if (!cachedConfig) {
    throw new ConfigNotInitializedError();
  }
  return cachedConfig;
}

/** Test-only escape hatch — production code should never call this. */
export function __resetConfigForTests(): void {
  cachedConfig = undefined;
}
