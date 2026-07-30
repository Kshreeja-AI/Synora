import { Job } from 'bullmq';

export interface JobData<T = Record<string, unknown>> {
  [key: string]: unknown;
  data: T;
}

export type JobType = 'generate_response' | 'index_message_search' | 'generate_embeddings' | 'process_file' | 'cleanup' | 'notification';

export interface JobTypeDefinition<T = Record<string, unknown>> {
  name: JobType;
  schema?: {
    validate: (data: unknown) => T;
  };
  timeout?: number;
  concurrency?: number;
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
}

export interface QueueJobHandler<T = Record<string, unknown>> {
  (job: Job<T>): Promise<void>;
}

export interface QueueMetrics {
  processed: number;
  failed: number;
  delayed: number;
  waiting: number;
  active: number;
  completed: number;
  paused: number;
  errors: Array<{
    jobId: string;
    error: string;
    timestamp: Date;
  }>;
}

export interface WorkerHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  workerId: string;
  processedCount: number;
  failedCount: number;
  uptime: number;
  lastHeartbeat: Date;
  activeJobs: number;
}

export interface QueueHealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  redis: {
    status: 'connected' | 'disconnected';
    latency?: number;
  };
  queues: Map<string, QueueMetrics>;
  workers: Map<string, WorkerHealth>;
}

export interface AuditEvent {
  type: 'job_created' | 'job_started' | 'job_completed' | 'job_failed' | 'job_retried' | 'job_moved_to_deadletter' | 'worker_started' | 'worker_stopped';
  jobType: JobType;
  jobId: string;
  timestamp: Date;
  details?: Record<string, unknown>;
  error?: string;
  workerId?: string;
}

export interface RateLimitState {
  jobsProcessedThisSecond: number;
  lastResetTime: number;
}

export interface DeadLetterEntry {
  jobId: string;
  jobType: JobType;
  data: Record<string, unknown>;
  failureReason: string;
  failureCount: number;
  lastFailureTime: Date;
  movedAt: Date;
  expiresAt: Date;
}

export interface WorkerOptions {
  concurrency: number;
  maxStalledCount?: number;
  maxStalledInterval?: number;
  lockDuration?: number;
  lockRenewTime?: number;
}

export interface QueueManagerConfig {
  redis: {
    url?: string;
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    tls?: boolean;
    maxRetriesPerRequest?: number;
    enableReadyCheck?: boolean;
    enableOfflineQueue?: boolean;
  };
  workers: {
    generateResponse: number;
    indexMessageSearch: number;
    generateEmbeddings: number;
    processFile: number;
    cleanup: number;
    notification: number;
  };
  retry: {
    attempts: number;
    backoffMs: number;
    backoffStrategy: 'exponential' | 'fixed';
  };
  deadLetter: {
    enabled: boolean;
    retention: number;
  };
  rateLimit: {
    enabled: boolean;
    maxJobsPerSecond: number;
  };
}
