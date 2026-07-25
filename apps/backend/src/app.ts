import { resolve } from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { prisma } from '@synora/database';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import type { AppConfig } from './config/types';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import projectRoutes from './routes/projects';
import documentRoutes from './routes/documents';
import imageRoutes from './routes/images';
import aiRoutes from './routes/ai';

export interface CreateAppDeps {
  /**
   * Probes whether the database is reachable. Defaults to a real query
   * against the shared Prisma singleton. Overridable so tests can exercise
   * /ready's failure branch deterministically, without needing to actually
   * take a real database offline.
   */
  checkDatabase?: () => Promise<unknown>;
}

const defaultCheckDatabase = (): Promise<unknown> => prisma.$queryRaw`SELECT 1`;

/**
 * Builds the fully-wired Express application without binding a network port.
 *
 * Kept separate from `index.ts` (the process entrypoint that calls
 * `.listen()`) so tests can exercise real routes and middleware — including
 * `/health` and `/ready` — via supertest against an in-memory app instance,
 * with no port to bind, leak, or collide with a parallel test run.
 */
export function createApp(config: AppConfig, deps: CreateAppDeps = {}): Express {
  const checkDatabase = deps.checkDatabase ?? defaultCheckDatabase;
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

  // Liveness: process is up and serving HTTP. Deliberately checks nothing
  // else — an orchestrator uses this to decide whether to restart the
  // container, and a slow/unavailable dependency should surface on /ready,
  // not trigger a restart loop here.
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      stage: config.stage,
      modes: config.modes,
    });
  });

  // Readiness: process is up AND can actually serve traffic. Orchestrators
  // (Kubernetes readiness probe, load balancer health check) use this to
  // decide whether to route traffic to this instance. A bounded timeout
  // keeps a hung database from hanging the readiness probe itself.
  app.get('/ready', async (req, res) => {
    const startedAt = Date.now();
    try {
      await Promise.race([
        checkDatabase(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('database probe timed out')), 2000)
        ),
      ]);
      res.json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: { status: 'ok', latencyMs: Date.now() - startedAt },
        },
      });
    } catch (error) {
      logger.warn('Readiness check failed: database unreachable', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            status: 'error',
            latencyMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          },
        },
      });
    }
  });

  // Locally-stored uploads (avatars). Only mounted for the `local` storage
  // provider — an object-storage provider (M6) serves files from its own
  // CDN/bucket URL instead, never through this app. Cross-Origin-Resource-
  // Policy is relaxed for this path only: the web app runs on a different
  // origin/port and needs to load these images directly in <img> tags,
  // while the rest of the API keeps helmet's stricter default.
  if (config.storage.provider === 'local') {
    app.use(
      config.storage.publicBasePath,
      (req, res, next) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        next();
      },
      express.static(resolve(process.cwd(), config.storage.localDirectory))
    );
  }

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/images', imageRoutes);
  app.use('/api/ai', aiRoutes);

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

  return app;
}
