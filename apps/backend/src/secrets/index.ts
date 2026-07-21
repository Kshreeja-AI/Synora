export * from './types';
export * from './errors';
export * from './serverOnly';
export * from './interfaces';
export * from './sources';
export { SecretsManager } from './secretsManager';
export type { SecretsManagerOptions } from './secretsManager';
export { LoggerAuditLog } from './audit/loggerAuditLog';
export { StubHsmProvider } from './hsm/stubHsmProvider';
export { SECRET_CATALOG } from './registry';
export { createDefaultSecretsManager, createSourceChain, detectEnvironment } from './factory';

import { createDefaultSecretsManager } from './factory';

/** Process-wide singleton — construct once, reuse everywhere. */
export const secretsManager = createDefaultSecretsManager();
