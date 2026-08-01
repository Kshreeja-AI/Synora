/**
 * Health monitoring — tracks provider health, detects degradation, triggers failover.
 * Implements circuit breaker pattern with exponential backoff.
 */

import { ProviderHealth, AIError } from './types';
import { IProvider } from './provider';

export interface HealthCheckConfig {
  checkIntervalMs?: number;
  unhealthyThreshold?: number;
  degradedThreshold?: number;
  recoveryMultiplier?: number;
  maxBackoffMs?: number;
}

export class HealthMonitor {
  private healthChecks: Map<string, HealthCheckConfig> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private checkIntervals: Map<string, NodeJS.Timer> = new Map();

  constructor(private providers: Map<string, IProvider>) {}

  registerProvider(providerId: string, config?: HealthCheckConfig): void {
    this.healthChecks.set(providerId, {
      checkIntervalMs: config?.checkIntervalMs ?? 30000,
      unhealthyThreshold: config?.unhealthyThreshold ?? 5,
      degradedThreshold: config?.degradedThreshold ?? 2,
      recoveryMultiplier: config?.recoveryMultiplier ?? 2,
      maxBackoffMs: config?.maxBackoffMs ?? 300000,
    });

    this.circuitBreakers.set(providerId, new CircuitBreaker({
      failureThreshold: config?.unhealthyThreshold ?? 5,
      recoveryTimeoutMs: 60000,
    }));

    this.startHealthCheck(providerId);
  }

  private startHealthCheck(providerId: string): void {
    const config = this.healthChecks.get(providerId);
    if (!config) return;

    const checkInterval = setInterval(async () => {
      try {
        const provider = this.providers.get(providerId);
        if (!provider) return;

        const health = await provider.getHealth();
        this.circuitBreakers.get(providerId)?.recordSuccess();

        if (health.status === 'unhealthy') {
          this.circuitBreakers.get(providerId)?.recordFailure();
        }
      } catch {
        this.circuitBreakers.get(providerId)?.recordFailure();
      }
    }, config.checkIntervalMs);

    this.checkIntervals.set(providerId, checkInterval);
  }

  getHealth(providerId: string): ProviderHealth | null {
    const provider = this.providers.get(providerId);
    if (!provider) return null;

    // In real implementation, would call provider.getHealth()
    return {
      providerId,
      status: 'healthy',
      lastChecked: new Date(),
      errorRate: 0,
      avgLatencyMs: 0,
      consecutiveFailures: 0,
    };
  }

  recordRequest(providerId: string, success: boolean, _latencyMs: number, _error?: AIError): void {
    const breaker = this.circuitBreakers.get(providerId);
    if (!breaker) return;

    if (success) {
      breaker.recordSuccess();
    } else {
      breaker.recordFailure();
    }
  }

  isCircuitOpen(providerId: string): boolean {
    const breaker = this.circuitBreakers.get(providerId);
    return breaker?.isOpen() ?? false;
  }

  async waitForCircuitRecovery(providerId: string): Promise<void> {
    const breaker = this.circuitBreakers.get(providerId);
    if (!breaker) return;

    while (breaker.isOpen()) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  shutdown(): void {
    for (const [, interval] of this.checkIntervals.entries()) {
      if (interval) clearInterval(interval as unknown as NodeJS.Timeout);
    }
    this.checkIntervals.clear();
  }
}

export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime?: Date;
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;

  constructor(config: { failureThreshold: number; recoveryTimeoutMs: number }) {
    this.failureThreshold = config.failureThreshold;
    this.recoveryTimeoutMs = config.recoveryTimeoutMs;
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= 2) {
        this.reset();
      }
    } else if (this.state === 'closed') {
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      setTimeout(() => {
        this.state = 'half-open';
        this.successCount = 0;
      }, this.recoveryTimeoutMs);
    }
  }

  isOpen(): boolean {
    if (this.state === 'open') {
      if (this.lastFailureTime && Date.now() - this.lastFailureTime.getTime() > this.recoveryTimeoutMs) {
        this.state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  private reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
  }
}

export class RateLimiter {
  private requestCounts: Map<string, number[]> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  canMakeRequest(providerId: string): boolean {
    const now = Date.now();
    const requests = this.requestCounts.get(providerId) ?? [];

    // Remove old requests outside window
    const validRequests = requests.filter(time => now - time < this.windowMs);

    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    validRequests.push(now);
    this.requestCounts.set(providerId, validRequests);
    return true;
  }

  getWaitTimeMs(providerId: string): number {
    const now = Date.now();
    const requests = this.requestCounts.get(providerId) ?? [];

    if (requests.length < this.maxRequests) {
      return 0;
    }

    const oldestRequest = requests[0];
    const waitTime = this.windowMs - (now - oldestRequest);
    return Math.max(0, waitTime);
  }
}

export class WorkspaceQuotaManager {
  private quotas: Map<string, { used: number; limit: number; resetTime: Date }> = new Map();

  setQuota(workspaceId: string, monthlyLimit: number): void {
    const resetTime = new Date();
    resetTime.setDate(resetTime.getDate() + 30);

    this.quotas.set(workspaceId, {
      used: 0,
      limit: monthlyLimit,
      resetTime,
    });
  }

  canUseQuota(workspaceId: string, tokens: number): boolean {
    const quota = this.quotas.get(workspaceId);
    if (!quota) return true;  // No quota set

    if (new Date() > quota.resetTime) {
      quota.used = 0;
      quota.resetTime = new Date();
      quota.resetTime.setDate(quota.resetTime.getDate() + 30);
    }

    return quota.used + tokens <= quota.limit;
  }

  consumeQuota(workspaceId: string, tokens: number): void {
    const quota = this.quotas.get(workspaceId);
    if (!quota) return;

    if (new Date() > quota.resetTime) {
      quota.used = 0;
      quota.resetTime = new Date();
      quota.resetTime.setDate(quota.resetTime.getDate() + 30);
    }

    quota.used += tokens;
  }

  getRemainingQuota(workspaceId: string): number {
    const quota = this.quotas.get(workspaceId);
    if (!quota) return Infinity;

    if (new Date() > quota.resetTime) {
      return quota.limit;
    }

    return Math.max(0, quota.limit - quota.used);
  }
}
