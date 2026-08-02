import { resolve } from 'node:path';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { prisma } from '@synora/database';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { csrfProtection } from './middleware/csrf';
import { cspMiddleware } from './middleware/csp';
import { correlationIdMiddleware } from './middleware/correlation-id';
import { requestTimeout } from './middleware/requestTimeout';
import type { AppConfig } from './config/types';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import projectRoutes from './routes/projects';
import documentRoutes from './routes/documents';
import imageRoutes from './routes/images';
import aiRoutes from './routes/ai';
import workspaceRoutes from './routes/workspaces';
import notificationRoutes from './routes/notifications';
import invitationRoutes from './routes/invitations';
import folderRoutes from './routes/folders';
import assetRoutes from './routes/assets';
import billingRoutes from './routes/billing';
import billingPlansRoutes from './routes/billingPlans';
import billingWebhookRoutes from './routes/billingWebhook';
import adminBillingRoutes from './routes/adminBilling';
import conversationRoutes from './routes/conversations';
import messageRoutes from './routes/messages';
import streamingRoutes from './routes/streaming';
import branchRoutes from './routes/branches';
import promptTemplateRoutes from './routes/promptTemplates';
import conversationTemplateRoutes from './routes/conversationTemplates'
import conversationFolderRoutes from './routes/conversationFolders';
import sharingRoutes from './routes/sharing'
import sharingPublicRoutes from './routes/sharing-public';
import memoryRoutes from './routes/memories';
import realtimeRoutes from './routes/realtime';
import searchRoutes from './routes/search';
import exportImportRoutes from './routes/export-import';
import { toolRoutes } from './routes/tools';
import toolSecretRoutes from './routes/toolSecrets';
import fileRoutes from './routes/files';
import feedbackRoutes from './routes/feedback';
import privacyConsentRoutes from './routes/privacyConsent';
import modelRegistryRoutes from './routes/modelRegistry';
import evaluationRoutes from './routes/evaluation';
import datasetExportRoutes from './routes/datasetExport';
import usageRoutes from './routes/usage';

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
  app.use(cspMiddleware);
  app.use(requestTimeout);
  app.use(correlationIdMiddleware as any);
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

  // Response Compression (gzip/brotli for all responses > 1KB)
  app.use(compression({ threshold: 1024 }));

  // Billing webhook needs raw body to verify Stripe signature (must be before json parsing)
  app.use('/api/billing', (req, res, next) => {
    if (req.path === '/webhook') {
      return express.raw({ type: 'application/json' })(req, res, () => {
        billingWebhookRoutes(req, res, next);
      });
    }
    next();
  });

  // Body Parser (for all other routes)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // Cookie parsing must run in every environment: the access/refresh tokens
  // (see setAuthCookies in routes/auth.ts) are httpOnly cookies the browser
  // frontend relies on exclusively (fetch with credentials: 'include', no
  // Authorization header) — without this, req.cookies is undefined and
  // every authenticated request 401s.
  app.use(cookieParser());

  // CSRF Protection (only in production/staging) — the double-submit cookie
  // pattern here isn't wired up on the frontend yet (no X-CSRF-Token header
  // sent on mutations), so enabling it in test/development would reject
  // every real mutating request rather than just forged ones. Tracked
  // separately; not addressed by this change.
  if (!['test', 'development'].includes(process.env.NODE_ENV || '')) {
    app.use(csrfProtection);
  }

  // Logging Middleware
  app.use(requestLogger);

  // Public shared conversation endpoint (before auth routes)
  app.use('/api/shared', sharingPublicRoutes)

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

  // Locally-stored uploads (avatars, workspace assets). Only mounted for the
  // `local` storage provider — a future object-storage provider serves files
  // from its own CDN/bucket URL instead, never through this app. Cross-Origin-Resource-
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
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api/workspaces', billingRoutes);
  app.use('/api/workspaces', folderRoutes);
  app.use('/api/workspaces', assetRoutes);
  app.use('/api/workspaces', conversationRoutes);
  app.use('/api/workspaces', messageRoutes);
  app.use('/api/workspaces', streamingRoutes);
  app.use('/api/workspaces', branchRoutes);
  app.use('/api/workspaces', promptTemplateRoutes);
  app.use('/api/workspaces', conversationTemplateRoutes);
  app.use('/api/workspaces', conversationFolderRoutes);
  app.use('/api/workspaces', sharingRoutes);
  app.use('/api/workspaces', memoryRoutes);
  app.use('/api/workspaces', realtimeRoutes);
  app.use('/api/workspaces', searchRoutes);
  app.use('/api/workspaces', exportImportRoutes);
  app.use('/api/workspaces', toolRoutes);
  app.use('/api/workspaces', toolSecretRoutes);
  app.use('/api/workspaces', fileRoutes);
  app.use('/api/workspaces', feedbackRoutes);
  app.use('/api/workspaces', privacyConsentRoutes);
  app.use('/api/workspaces', modelRegistryRoutes);
  app.use('/api/workspaces', evaluationRoutes);
  app.use('/api/workspaces', datasetExportRoutes);
  app.use('/api/workspaces', usageRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/invitations', invitationRoutes);
  app.use('/api/billing', billingPlansRoutes);
  app.use('/api/admin', adminBillingRoutes);

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
