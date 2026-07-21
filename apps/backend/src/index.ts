import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { secretsManager } from './secrets';
import { initConfig } from './config';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import projectRoutes from './routes/projects';
import documentRoutes from './routes/documents';
import imageRoutes from './routes/images';

async function bootstrap() {
  // Fail fast: secrets before config (config's DATABASE_URL/provider flags
  // depend on SecretsManager), config before anything else touches env vars.
  await secretsManager.validateRequired();
  const config = await initConfig();

  const app = express();

  // Security Middleware
  app.use(helmet());
  app.use(
    cors({
      origin: config.server.corsOrigins,
      credentials: true,
    })
  );

  // Rate Limiting
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: 'Too many requests from this IP, please try again later.',
  });

  app.use('/api/', limiter);

  // Body Parser
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // Logging Middleware
  app.use(requestLogger);

  // Health Check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      stage: config.stage,
      modes: config.modes,
    });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/images', imageRoutes);

  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  // Error Handler (must be last)
  app.use(errorHandler);

  app.listen(config.server.port, () => {
    logger.info(`🚀 Server running at http://localhost:${config.server.port}`);
    logger.info(`📚 API available at http://localhost:${config.server.port}/api`);
    logger.info(`🔐 Stage: ${config.stage} | Modes: ${JSON.stringify(config.modes)}`);
  });

  return app;
}

const appPromise: Promise<unknown> = bootstrap().catch((error) => {
  logger.error('Startup aborted', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

export default appPromise;
