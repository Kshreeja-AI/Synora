import { VectorDBMetricsCollector } from './metrics';

export type VectorDBHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface VectorDBHealthCheck {
  status: VectorDBHealthStatus;
  providerId: string;
  combinedErrorRate: number;
  totalCalls: number;
}

/**
 * Health status for the vector DB subsystem, derived from
 * `VectorDBMetricsCollector` rather than a dedicated network ping: every
 * operation (`upsert`/`query`/`delete`) is already an HTTP round-trip to
 * the provider, so its success/failure is already being recorded — a
 * separate ping call would just be one more request that tells us nothing
 * a real operation hasn't already told us more recently.
 */
export class HealthChecker {
  constructor(private readonly metricsCollector: VectorDBMetricsCollector) {}

  check(providerId: string): VectorDBHealthCheck {
    const metrics = this.metricsCollector.getMetrics(providerId);

    const totalCalls = metrics.upsert.calls + metrics.query.calls + metrics.delete.calls;
    const totalErrors = metrics.upsert.errors + metrics.query.errors + metrics.delete.errors;
    const combinedErrorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;

    let status: VectorDBHealthStatus = 'healthy';
    if (totalCalls > 0) {
      if (combinedErrorRate > 0.5) status = 'unhealthy';
      else if (combinedErrorRate > 0.1) status = 'degraded';
    }

    return { status, providerId, combinedErrorRate, totalCalls };
  }
}

let healthChecker: HealthChecker | null = null;

export function initHealthChecker(metricsCollector: VectorDBMetricsCollector): HealthChecker {
  healthChecker = new HealthChecker(metricsCollector);
  return healthChecker;
}

export function getHealthChecker(metricsCollector: VectorDBMetricsCollector): HealthChecker {
  if (!healthChecker) {
    healthChecker = new HealthChecker(metricsCollector);
  }
  return healthChecker;
}

export function resetHealthCheckerForTests(): void {
  healthChecker = null;
}
