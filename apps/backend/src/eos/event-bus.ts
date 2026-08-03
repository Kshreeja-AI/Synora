import { EventEmitter } from 'node:events';

export interface EngineeringEvent {
  type: string;
  timestamp: number;
  source: string;
  payload: Record<string, unknown>;
}

export interface WorkerJobEvent extends EngineeringEvent {
  type: 'worker.job.completed' | 'worker.job.failed';
  payload: {
    queue: string;
    jobId: string;
    durationMs?: number;
    error?: string;
    attempts?: number;
  };
}

export interface DeploymentEvent extends EngineeringEvent {
  type: 'deployment.started' | 'deployment.succeeded' | 'deployment.failed';
  payload: {
    version: string;
    environment: string;
    commitSha?: string;
  };
}

export interface ApiRequestEvent extends EngineeringEvent {
  type: 'api.request.slow' | 'api.request.error';
  payload: {
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    error?: string;
  };
}

export interface HealthCheckEvent extends EngineeringEvent {
  type: 'health.check';
  payload: {
    service: string;
    status: 'healthy' | 'degraded' | 'down';
    details?: Record<string, unknown>;
  };
}

export interface BootEvent extends EngineeringEvent {
  type: 'server.boot';
  payload: {
    durationMs: number;
    nodeVersion: string;
    pid: number;
    memoryMb: number;
  };
}

export interface QueueDepthEvent extends EngineeringEvent {
  type: 'queue.depth';
  payload: {
    queue: string;
    waiting: number;
    active: number;
    delayed: number;
    depth: number;
  };
}

export interface AlertErrorRateEvent extends EngineeringEvent {
  type: 'alert.error_rate';
  payload: {
    errorsInWindow: number;
    windowMs: number;
    threshold: number;
  };
}

export interface ProcessMemoryEvent extends EngineeringEvent {
  type: 'process.memory';
  payload: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    arrayBuffersMb: number;
  };
}

export interface ApiLatencySummaryEvent extends EngineeringEvent {
  type: 'api.latency.summary';
  payload: {
    count: number;
    p50: number;
    p95: number;
    p99: number;
    mean: number;
  };
}

export interface AiProviderObservationEvent extends EngineeringEvent {
  type: 'ai.provider.observation';
  payload: {
    providerId: string;
    modelId: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    success: boolean;
    errorCode?: string;
    /**
     * Whether this capability is priced per token at all. Derived from
     * whether the caller supplied token/cost fields, not from whether they
     * happen to be zero — a token-priced call really costing zero must stay
     * distinguishable from a capability that is not token-priced.
     */
    tokenPriced: boolean;
    /** How the call is billed. Absent means the caller did not say. */
    pricingBasis?: 'token' | 'per-image' | 'per-character' | 'per-second';
    /**
     * Whether `costCents` was reported by the provider ('observed') or
     * derived from a published price table ('stated'). A stated figure is a
     * claim about a published rate, not a measurement.
     */
    costProvenance?: 'observed' | 'stated';
  };
}

export interface PromptOutcomeEvent extends EngineeringEvent {
  type: 'ai.prompt.outcome';
  payload: {
    promptId: string;
    version?: number;
    success: boolean;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    costCents?: number;
  };
}

export interface AlertPromptRegressionEvent extends EngineeringEvent {
  type: 'alert.prompt_regression';
  payload: {
    promptId: string;
    version: number;
    overallSuccessRate: number;
    recentSuccessRate: number;
    windowSize: number;
  };
}

export interface AlertCostAnomalyEvent extends EngineeringEvent {
  type: 'alert.cost_anomaly';
  payload: {
    providerId: string;
    modelId: string;
    /** Mean cost per request over the established baseline period. */
    baselineCostCents: number;
    /** Mean cost per request over the recent window. */
    recentCostCents: number;
    /**
     * recent ÷ baseline. Null when the baseline is zero — cost appearing
     * where there was none is a real signal, but it is not a multiple of
     * anything, and reporting it as a number would invent precision.
     */
    ratio: number | null;
    baselineSamples: number;
    windowSize: number;
  };
}

export interface EngineeringSnapshotEvent extends EngineeringEvent {
  type: 'engineering.snapshot';
  payload: {
    store: string;
    providerCount: number;
    promptCount: number;
    regressingPrompts: number;
  };
}

export interface EvaluationRunCompletedEvent extends EngineeringEvent {
  type: 'evaluation.run.completed';
  payload: {
    runId: string;
    datasetId: string;
    datasetVersion: number;
    label: string;
    totalCases: number;
    passRate: number;
    meanScore: number;
    erroredCases: number;
    durationMs: number;
  };
}

export interface AiInteractionCompletedEvent extends EngineeringEvent {
  type: 'ai.interaction.completed';
  payload: {
    promptId: string;
    input: string;
    output: string;
    success: boolean;
    rating?: number;
    consented?: boolean;
    tags?: string[];
    note?: string;
  };
}

export interface EvaluationCaseCapturedEvent extends EngineeringEvent {
  type: 'evaluation.case.captured';
  payload: {
    caseId: string;
    datasetId: string;
    promptId: string;
    reason: string;
    redactedInput: boolean;
    redactedOutput: boolean;
    redactionCounts: Record<string, number>;
  };
}

export interface ProposalCreatedEvent extends EngineeringEvent {
  type: 'proposal.created';
  payload: {
    proposalId: string;
    trigger: string;
    title: string;
    affectedCases: number;
    caveats: number;
  };
}

export interface ProposalDraftAttachedEvent extends EngineeringEvent {
  type: 'proposal.draft.attached';
  payload: {
    proposalId: string;
    hasDraft: boolean;
    /** False when a draft was written but never run against the failures. */
    measured: boolean;
    verdict: string;
  };
}

export interface ProposalExecutionCompletedEvent extends EngineeringEvent {
  type: 'proposal.execution.completed';
  payload: {
    proposalId: string;
    outcome: 'pull-request-opened' | 'tests-failed' | 'refused' | 'error';
    branch?: string;
    pullRequestUrl?: string;
    reason?: string;
  };
}

export interface ProposalDecidedEvent extends EngineeringEvent {
  type: 'proposal.decided';
  payload: { proposalId: string; decision: 'approved' | 'rejected'; hasNote: boolean };
}

export type KnownEvent =
  | WorkerJobEvent
  | DeploymentEvent
  | ApiRequestEvent
  | HealthCheckEvent
  | BootEvent
  | QueueDepthEvent
  | AlertErrorRateEvent
  | ProcessMemoryEvent
  | ApiLatencySummaryEvent
  | AiProviderObservationEvent
  | PromptOutcomeEvent
  | AlertPromptRegressionEvent
  | AlertCostAnomalyEvent
  | EngineeringSnapshotEvent
  | EvaluationRunCompletedEvent
  | AiInteractionCompletedEvent
  | EvaluationCaseCapturedEvent
  | ProposalCreatedEvent
  | ProposalDraftAttachedEvent
  | ProposalExecutionCompletedEvent
  | ProposalDecidedEvent
  | EngineeringEvent;

type EventHandler = (event: KnownEvent) => void;

export class EngineeringEventBus {
  private emitter = new EventEmitter();
  private ringBuffer: KnownEvent[] = [];
  private readonly maxBufferSize: number;

  constructor(maxBufferSize = 1000) {
    this.maxBufferSize = maxBufferSize;
    this.emitter.setMaxListeners(50);
  }

  emit(event: KnownEvent): void {
    this.ringBuffer.push(event);
    if (this.ringBuffer.length > this.maxBufferSize) {
      this.ringBuffer.shift();
    }
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }

  on(eventType: string, handler: EventHandler): () => void {
    this.emitter.on(eventType, handler);
    return () => this.emitter.off(eventType, handler);
  }

  onAll(handler: EventHandler): () => void {
    return this.on('*', handler);
  }

  recentEvents(limit = 100): readonly KnownEvent[] {
    return this.ringBuffer.slice(-limit);
  }

  recentByType(type: string, limit = 50): readonly KnownEvent[] {
    return this.ringBuffer.filter((e) => e.type === type).slice(-limit);
  }

  /**
   * How many subscribers are attached to one event type. Observed evidence
   * rather than a declaration: a count of zero means nothing is processing
   * this event, whatever any startup code claims to have done.
   */
  listenerCountFor(eventType: string): number {
    return this.emitter.listenerCount(eventType);
  }

  stats(): { totalEmitted: number; bufferSize: number; listenerCount: number } {
    return {
      totalEmitted: this.ringBuffer.length,
      bufferSize: this.maxBufferSize,
      listenerCount: this.emitter.listenerCount('*'),
    };
  }
}

export const engineeringEventBus = new EngineeringEventBus();
