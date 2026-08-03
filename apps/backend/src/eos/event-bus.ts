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

export type KnownEvent =
  | WorkerJobEvent
  | DeploymentEvent
  | ApiRequestEvent
  | HealthCheckEvent
  | BootEvent
  | QueueDepthEvent
  | AlertErrorRateEvent
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

  stats(): { totalEmitted: number; bufferSize: number; listenerCount: number } {
    return {
      totalEmitted: this.ringBuffer.length,
      bufferSize: this.maxBufferSize,
      listenerCount: this.emitter.listenerCount('*'),
    };
  }
}

export const engineeringEventBus = new EngineeringEventBus();
