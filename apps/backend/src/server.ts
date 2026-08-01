import type { Server } from 'node:http';
import { Express } from 'express';
import { logger } from './utils/logger';
import { prisma } from '@synora/database';
import { initializeApp } from './index';
import { AppConfig } from './config';
import { realtimeService } from './services/realtime.service';

/**
 * Returns the underlying `http.Server`, not just a resolved Promise, so a
 * real-time layer (WebSocket presence/collaboration) can attach to it.
 * `app.listen(...)` already creates and returns exactly this server.
 */
async function startServer(app: Express, config: AppConfig): Promise<Server> {
  return new Promise<Server>((resolve) => {
    const server = app.listen(config.server.port, '0.0.0.0', () => {
      realtimeService.initialize(server);
      logger.info(`🚀 Server running at http://localhost:${config.server.port}`);
      logger.info(`📚 API available at http://localhost:${config.server.port}/api`);
      logger.info(`🔐 Stage: ${config.stage} | Modes: ${JSON.stringify(config.modes)}`);
      resolve(server);
    });
  });
}

let httpServer: Server | undefined;

async function bootstrap() {
  const { app, config } = await initializeApp();
  httpServer = await startServer(app, config);
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully...`);
  try {
    await new Promise<void>((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(() => resolve());
    });
    await prisma.$disconnect();
  } catch (error) {
    logger.error('Error during Prisma disconnect on shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  process.exit(0);
}

const appPromise: Promise<unknown> = bootstrap().catch((error) => {
  logger.error('Startup aborted', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

export default appPromise;
