import { createLogger } from '@synora/logger';
import { config } from './config.js';

export const rootLogger = createLogger({
  level: config.app.logLevel,
  name: config.app.name,
  pretty: config.app.nodeEnv === 'development',
});
