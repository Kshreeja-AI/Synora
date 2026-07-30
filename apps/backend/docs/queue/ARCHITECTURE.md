# Queue Architecture

## Overview

The Production Queue Infrastructure is a robust, enterprise-grade job queue system built on BullMQ and Redis. It provides:

- **Provider-agnostic abstraction** over BullMQ/Redis
- **Automatic retry with exponential backoff**
- **Dead-letter queue** for failed jobs
- **Comprehensive metrics and monitoring**
- **Structured audit logging**
- **Health checks and graceful shutdown**
- **Rate limiting and concurrency controls**
- **Worker lifecycle management**

## Components

### 1. Redis Connection Manager (`redis.ts`)

Manages the Redis connection with:
- Connection pooling
- TLS support
- Automatic reconnection
- Event logging
- Health checks

**Usage:**
```typescript
import { initRedis, getRedis, getRedisConnection } from '@synora/backend/queue';

// Initialize once at application startup
initRedis({
  host: 'localhost',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  tls: process.env.NODE_ENV === 'production',
});

// Get connection anywhere in the app
const redis = getRedisConnection();
```

### 2. Registry (`registry.ts`)

Manages job and queue registration with:
- Job type registration
- Queue mapping
- Handler registration
- Validation of registered types

**Usage:**
```typescript
import { getJobRegistry, getQueueRegistry } from '@synora/backend/queue';

const jobRegistry = getJobRegistry();
const queueRegistry = getQueueRegistry();

// Check if job type is registered
if (jobRegistry.isJobTypeRegistered('generate_response')) {
  // Process
}
```

### 3. Retry Manager (`retry.ts`)

Handles retry logic with:
- Exponential backoff
- Fixed delay strategy
- Retryable error detection
- Retry attempt tracking

**Configuration:**
```typescript
{
  retry: {
    attempts: 3,                          // Max retry attempts
    backoffMs: 1000,                      // Initial backoff delay
    backoffStrategy: 'exponential'        // 'exponential' or 'fixed'
  }
}
```

**Exponential backoff example:**
- Attempt 1: 1000ms
- Attempt 2: 2000ms (1000 * 2^1)
- Attempt 3: 4000ms (1000 * 2^2)

### 4. Dead-Letter Queue (`deadletter.ts`)

Manages permanently failed jobs with:
- Dead-letter entry storage
- Job retrieval and retry
- Automatic cleanup (TTL-based)
- Audit trail

**Configuration:**
```typescript
{
  deadLetter: {
    enabled: true,
    retention: 86400000  // 24 hours in milliseconds
  }
}
```

### 5. Metrics Collector (`metrics.ts`)

Collects metrics including:
- Queue depth (waiting, active, completed, failed, delayed)
- Worker health status
- Error rates
- Job processing counts

**Usage:**
```typescript
import { getMetricsCollector } from '@synora/backend/queue';

const collector = getMetricsCollector();
const metrics = await collector.collectMetrics('generate_response');

// Returns: { processed, failed, delayed, waiting, active, completed, paused, errors }
```

### 6. Health Checker (`health.ts`)

Provides health status including:
- Redis connection status
- Queue metrics
- Worker health
- Overall system status

**Possible statuses:** `healthy`, `degraded`, `unhealthy`

### 7. Audit Logger (`audit.ts`)

Records all queue events including:
- Job creation, start, completion, failure
- Job retries and dead-letter movements
- Worker starts and stops
- Timestamp and context tracking

**Events logged:**
- `job_created`
- `job_started`
- `job_completed`
- `job_failed`
- `job_retried`
- `job_moved_to_deadletter`
- `worker_started`
- `worker_stopped`

### 8. Worker Abstraction (`worker.ts`)

Encapsulates worker lifecycle with:
- Job processing
- Error handling and retries
- Metrics collection
- Audit logging
- Event handlers

**Worker lifecycle:**
1. Job received
2. Handler executed
3. Success/failure recorded
4. Metrics updated
5. Audit event logged

### 9. Queue Manager (`manager.ts`)

Central orchestrator providing:
- Queue initialization
- Job type registration
- Worker creation and lifecycle
- Graceful shutdown
- Audit log access

## Job Types

Six built-in job types:

| Job Type | Concurrency | Purpose |
|----------|-------------|---------|
| `generate_response` | 5 | AI message generation |
| `index_message_search` | 2 | Full-text search indexing |
| `generate_embeddings` | 2 | Vector embedding generation |
| `process_file` | 3 | File upload processing |
| `cleanup` | 1 | Maintenance tasks |
| `notification` | 2 | User notifications |

**Adding new job type:**
```typescript
const queueManager = getQueueManager();

queueManager.registerJobType(
  {
    name: 'export_conversation',
    timeout: 60000,
    concurrency: 2,
    attempts: 2,
  },
  async (job) => {
    // Process job
  }
);

await queueManager.startWorkers('export_conversation', 2);
```

## Initialization

**In application startup (`server.ts`):**
```typescript
import { initQueueManager } from '@synora/backend/queue';

async function startServer() {
  const queueManager = await initQueueManager();
  
  // Register job types
  queueManager.registerJobType(generateResponseDefinition, generateResponseHandler);
  queueManager.registerJobType(indexMessageSearchDefinition, indexMessageSearchHandler);
  
  // Start workers based on config
  const config = getConfig();
  for (const [jobType, concurrency] of Object.entries(config.queue.workers)) {
    await queueManager.startWorkers(jobType as JobType, concurrency);
  }
  
  // Setup graceful shutdown
  queueManager.setupGracefulShutdown();
  
  // Start Express server...
}
```

## Failure Recovery

### Automatic Recovery

1. **Job Failure:**
   - Caught by worker
   - Error type evaluated
   - Retryable? → Enqueue with backoff
   - Non-retryable? → Move to dead-letter queue

2. **Retry Loop:**
   - Exponential backoff applied
   - Max attempts checked
   - Failed on final attempt? → Dead-letter queue

3. **Dead-Letter Processing:**
   - Entry stored with expiration
   - Accessible for manual retry
   - Auto-cleaned after TTL

### Manual Recovery

```typescript
import { getDeadLetterQueue, getQueueManager } from '@synora/backend/queue';

const dlq = getDeadLetterQueue();
const queueManager = getQueueManager();

// Get failed job from DLQ
const entry = dlq.getEntry('job-id');

if (entry) {
  // Retry the job
  const failedEntry = dlq.retryJob('job-id');
  const queue = await queueManager.getQueueByJobType(entry.jobType);
  
  if (queue) {
    await queue.add(entry.jobType, failedEntry.data, {
      attempts: 1,
    });
  }
}
```

## Performance Considerations

### Concurrency

- **Default:** 1 concurrent job per worker
- **Scaling:** Increase worker count, not concurrency per worker
- **Memory:** Each concurrent job maintains memory

### Rate Limiting

```typescript
{
  rateLimit: {
    enabled: true,
    maxJobsPerSecond: 100
  }
}
```

### Queue Metrics

Monitor key metrics:
- `waiting`: Jobs queued, not yet processed
- `active`: Jobs currently processing
- `completed`: Jobs successfully processed
- `failed`: Jobs that failed (before moving to DLQ)
- `delayed`: Jobs scheduled for future execution

### Scaling Strategy

1. **Vertical scaling:** Increase worker concurrency (per process)
2. **Horizontal scaling:** Add more worker processes
3. **Queue sharding:** Split jobs across multiple queue instances
4. **Kubernetes:** Deploy workers as separate pods

## Configuration

**Environment variables:**
```bash
# Redis connection
QUEUE_REDIS_URL=redis://localhost:6379
# OR
QUEUE_REDIS_HOST=localhost
QUEUE_REDIS_PORT=6379
QUEUE_REDIS_PASSWORD=...
QUEUE_REDIS_DB=0

# Worker concurrency
QUEUE_WORKER_GENERATE_RESPONSE=5
QUEUE_WORKER_INDEX_MESSAGE_SEARCH=2
QUEUE_WORKER_GENERATE_EMBEDDINGS=2
QUEUE_WORKER_PROCESS_FILE=3
QUEUE_WORKER_CLEANUP=1
QUEUE_WORKER_NOTIFICATION=2

# Retry policy
QUEUE_RETRY_ATTEMPTS=3
QUEUE_RETRY_BACKOFF_MS=1000
QUEUE_RETRY_BACKOFF_STRATEGY=exponential

# Dead-letter queue
QUEUE_DEADLETTER_ENABLED=true
QUEUE_DEADLETTER_RETENTION=86400000  # 24 hours

# Rate limiting
QUEUE_RATELIMIT_ENABLED=true
QUEUE_RATELIMIT_MAX_JOBS_PER_SECOND=100
```

## Monitoring

### Health Endpoint

```typescript
import { getHealthChecker } from '@synora/backend/queue';

app.get('/health/queue', async (req, res) => {
  const healthChecker = getHealthChecker();
  const health = await healthChecker.check();
  
  res.status(health.status === 'healthy' ? 200 : 503).json({
    status: health.status,
    redis: health.redis,
    queues: Object.fromEntries(health.queues),
    workers: Object.fromEntries(health.workers),
  });
});
```

### Audit Log Retrieval

```typescript
import { getQueueAuditLog } from '@synora/backend/queue';

const auditLog = getQueueAuditLog();

// Get last 100 events
const events = auditLog.getEvents(100);

// Get events for specific job type
const jobTypeEvents = auditLog.getEventsByJobType('generate_response', 50);
```

## Best Practices

1. **Job Timeout:** Set reasonable timeouts (30-60 seconds for most jobs)
2. **Idempotency:** Design handlers to be idempotent (safe to retry)
3. **Error Classification:** Only retry on transient errors
4. **Logging:** Log all job details for debugging
5. **Monitoring:** Track metrics for capacity planning
6. **Graceful Shutdown:** Always call `queueManager.shutdown()` on SIGTERM/SIGINT
7. **Testing:** Use mock providers and test queue behavior
8. **Dead-Letter Monitoring:** Alert on DLQ growth

## Testing

```typescript
import { resetRegistriesForTests, resetDeadLetterQueueForTests } from '@synora/backend/queue';

// Clear state before each test
beforeEach(() => {
  resetRegistriesForTests();
  resetDeadLetterQueueForTests();
});

// Test job processing
it('should process job successfully', async () => {
  // Register and test
});
```

## Troubleshooting

### Jobs not processing

1. Check Redis connection: `getRedis().ping()`
2. Verify workers started: `getQueueManager().workers`
3. Check job registration: `getJobRegistry().isJobTypeRegistered()`
4. Review worker logs for errors

### High failure rate

1. Check error types in audit log
2. Increase retry attempts if transient errors
3. Review dead-letter queue contents
4. Check worker memory/CPU usage

### Memory leaks

1. Monitor worker.activeJobs
2. Ensure cleanup on job completion
3. Check for circular references in job data
4. Review dead-letter queue size
