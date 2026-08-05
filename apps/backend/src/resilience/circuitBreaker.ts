import { logger } from '../utils/logger';

/**
 * Shared per-provider circuit breaker.
 *
 * MOVED HERE FROM `embeddings/circuitBreaker.ts` (which now re-exports
 * this file) so every provider-calling stack trips and recovers by the
 * same rules. The module-level registry below remains the EMBEDDINGS
 * stack's singleton — other stacks construct their own
 * `CircuitBreakerRegistry`, because a text-provider outage must not
 * open the circuit for embeddings calls to the same vendor and vice
 * versa: the two APIs fail independently in practice.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Consecutive failures required to trip from closed to open. */
  failureThreshold: number;
  /** How long the circuit stays open before allowing a half-open trial call. */
  cooldownMs: number;
  /** Consecutive successful half-open trials required to close the circuit again. */
  halfOpenSuccessThreshold: number;
}

/**
 * Per-provider circuit breaker: closed (normal) -> open (failing fast,
 * protecting a struggling upstream from a retry storm) -> half-open
 * (cautiously testing recovery) -> closed again. This sits *above* the
 * retry layer in the call path — retry handles transient blips within one
 * call, the circuit breaker handles a provider that's down for an extended
 * period, where retrying every single call would just add latency and load
 * without any chance of success.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveHalfOpenSuccesses = 0;
  private openedAt = 0;

  constructor(
    private readonly providerId: string,
    private readonly config: CircuitBreakerConfig
  ) {}

  getState(): CircuitState {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.config.cooldownMs) {
      this.transitionTo('half-open');
    }
    return this.state;
  }

  /** Whether a call should be allowed to proceed right now. */
  canAttempt(): boolean {
    return this.getState() !== 'open';
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.consecutiveHalfOpenSuccesses += 1;
      if (this.consecutiveHalfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
        this.transitionTo('closed');
      }
      return;
    }
    this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    if (this.state === 'half-open') {
      this.transitionTo('open');
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private transitionTo(next: CircuitState): void {
    const previous = this.state;
    this.state = next;

    if (next === 'open') {
      this.openedAt = Date.now();
      this.consecutiveHalfOpenSuccesses = 0;
    } else if (next === 'closed') {
      this.consecutiveFailures = 0;
      this.consecutiveHalfOpenSuccesses = 0;
    } else if (next === 'half-open') {
      this.consecutiveHalfOpenSuccesses = 0;
    }

    if (previous !== next) {
      logger.info('[CircuitBreaker] State transition', {
        providerId: this.providerId,
        from: previous,
        to: next,
      });
    }
  }
}

/**
 * One breaker instance per provider id, created lazily on first use so a
 * provider that's never called never allocates state.
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly config: CircuitBreakerConfig) {}

  get(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker(providerId, this.config);
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  getAllStates(): Map<string, CircuitState> {
    const states = new Map<string, CircuitState>();
    for (const [id, breaker] of this.breakers) {
      states.set(id, breaker.getState());
    }
    return states;
  }
}

let circuitBreakerRegistry: CircuitBreakerRegistry | null = null;

export function initCircuitBreakerRegistry(config: CircuitBreakerConfig): CircuitBreakerRegistry {
  circuitBreakerRegistry = new CircuitBreakerRegistry(config);
  return circuitBreakerRegistry;
}

export function getCircuitBreakerRegistry(): CircuitBreakerRegistry {
  if (!circuitBreakerRegistry) {
    circuitBreakerRegistry = new CircuitBreakerRegistry({
      failureThreshold: 5,
      cooldownMs: 30_000,
      halfOpenSuccessThreshold: 2,
    });
  }
  return circuitBreakerRegistry;
}

export function resetCircuitBreakerRegistryForTests(): void {
  circuitBreakerRegistry = null;
}
