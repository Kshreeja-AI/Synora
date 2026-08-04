import type { Server } from 'node:http';
import { Express } from 'express';
import { logger } from './utils/logger';
import { prisma } from '@synora/database';
import { initializeApp } from './index';
import { AppConfig } from './config';
import { realtimeService } from './services/realtime.service';
import { initObservability, shutdownObservability } from './monitoring';
import { markBootStart, emitBootComplete } from './eos/boot-collector.js';
import { registerDependencyProbes } from './eos/dependency-probes.js';
import { startErrorRateMonitor } from './eos/error-rate-monitor.js';
import { startLatencyTracker } from './eos/latency-tracker.js';
import { startMemoryCollector } from './eos/memory-collector.js';
import { startProviderObservatory } from './eos/provider-observatory.js';
import { startPromptIntelligence } from './eos/prompt-intelligence.js';
import { startCostMonitor } from './eos/cost-monitor.js';
import { startLatencyDrift } from './eos/latency-drift.js';
import { startProviderDegradation } from './eos/provider-degradation.js';
import { startProposalEngine } from './eos/proposal-engine.js';
import { registerEgressPaths } from './eos/egress-registry.js';
import { wireJudgeIfProviderAvailable } from './eos/judge-wiring.js';
import { bootAgentStores } from './agents/boot.js';

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
  markBootStart();
  // Before the app: Sentry must exist before the first request can error,
  // and the tracer provider must be registered before spans are created.
  // Both are credential-gated no-ops when unconfigured.
  initObservability();
  const { app, config } = await initializeApp();
  // Awaited before the server accepts traffic: an unhydrated registry would
  // answer 404 for agents that exist, which is a confident wrong answer.
  await bootAgentStores();
  httpServer = await startServer(app, config);
  registerDependencyProbes();
  registerEgressPaths();
  startErrorRateMonitor();
  startLatencyTracker();
  startMemoryCollector();
  startProviderObservatory();
  startPromptIntelligence();
  startCostMonitor();
  startLatencyDrift();
  startProviderDegradation();
  // Started last: the proposal engine listens for the alerts the detectors
  // above raise. Without it running, alerts fire into nothing and the
  // founder's proposals list stays permanently empty.
  startProposalEngine();
  // Not awaited: resolving a provider can involve a network probe, and boot
  // must not block on it. The judge is absent until this settles, which the
  // gates already report honestly as unmeasured.
  void wireJudgeIfProviderAvailable();
  emitBootComplete();
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully...`);
  try {
    await new Promise<void>((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(() => resolve());
    });
    await prisma.$disconnect();
    // Flush buffered error events and trace batches before the process dies —
    // otherwise the report about why we were shutting down is the first
    // thing lost.
    await shutdownObservability();
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
