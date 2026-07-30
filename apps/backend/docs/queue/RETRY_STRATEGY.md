# Queue Retry Strategy and Failure Recovery

## Overview

The retry system uses exponential backoff with configurable attempts to handle transient failures. Jobs are only retried for retryable errors; permanent failures move directly to the dead-letter queue.

## Retry Policy

### Configuration

```typescript
{
  retry: {
    attempts: 3,                    // Maximum retry attempts
    backoffMs: 1000,                // Initial backoff (1 second)
    backoffStrategy: 'exponential'  // 'exponential' or 'fixed'
  }
}
```

### Exponential Backoff Calculation

```
delay = backoffMs * (2 ^ (attemptNumber - 1))

Attempt 1: 1000ms * 2^0 = 1000ms (1 second)
Attempt 2: 1000ms * 2^1 = 2000ms (2 seconds)
Attempt 3: 1000ms * 2^2 = 4000ms (4 seconds)
```

**Total wait time:** 1 + 2 + 4 = 7 seconds before dead-letter queue

### Fixed Backoff

```
delay = backoffMs (constant)

Attempt 1: 1000ms
Attempt 2: 1000ms
Attempt 3: 1000ms
```

**Total wait time:** 3 seconds before dead-letter queue

## Retryable vs. Non-Retryable Errors

### Retryable Errors (transient)

These errors indicate temporary conditions that may resolve on retry:

- `ECONNREFUSED` — Connection refused (service temporarily down)
- `ENOTFOUND` — DNS resolution failed (network temporarily unavailable)
- `ETIMEDOUT` — Operation timed out (slow network, high load)
- `EHOSTUNREACH` — Host unreachable (network issue)
- `ENETUNREACH` — Network unreachable (routing issue)
- `ECONNRESET` — Connection reset by peer (temporary network issue)
- Messages containing: `timeout`, `network`, `unavailable`, `temporarily`

### Non-Retryable Errors (permanent)

These errors indicate the job itself is invalid and should not retry:

- Invalid input/validation errors
- Authentication/authorization failures
- Missing required parameters
- Unsupported operations
- Database constraint violations (unique, foreign key)
- User not found / resource deleted
- Custom application errors marked as non-retryable

### Example

```typescript
import { getRetryManager } from '@synora/backend/queue';

const retryManager = getRetryManager();

// Retryable error
const networkError = new Error('ETIMEDOUT');
console.log(retryManager.shouldRetry(1, networkError));  // true

// Non-retryable error
const validationError = new Error('Invalid message content');
console.log(retryManager.shouldRetry(1, validationError));  // false
```

## Retry Flow

```
Job Enqueued
    ↓
Worker Starts Processing
    ↓
    ├─ SUCCESS → Mark Complete, Log Success
    │
    └─ FAILURE
        ↓
        Evaluate Error
        ├─ Non-Retryable → Dead-Letter Queue (immediate)
        ├─ Max Attempts Reached → Dead-Letter Queue
        └─ Retryable & Attempts < Max
            ↓
            Calculate Backoff Delay
            ↓
            Enqueue for Retry (with delay)
            ↓
            Log Retry Attempt
            ↓
            Wait (exponential delay)
            ↓
            [Return to Worker Starts Processing]
```

## Implementation Details

### Job Handler Retry Logic

```typescript
async function processJob(job: Job): Promise<void> {
  try {
    // Process the job
    await handler(job);
    
    // Record success
    auditLog.recordJobCompleted(jobType, jobId);
  } catch (error) {
    const attemptNumber = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts || 3;

    if (attemptNumber >= maxAttempts) {
      // Exceeded max attempts - move to dead-letter queue
      deadLetterQueue.moveToDeadLetter(
        jobId,
        jobType,
        job.data,
        error.message,
        attemptNumber
      );
      
      throw error;  // Signal failure to BullMQ
    }

    // Still have retry attempts - queue for retry with backoff
    const delay = retryManager.getNextDelay(attemptNumber);
    retryManager.recordRetry(jobId, jobType, attemptNumber, error.message);
    
    throw new Error(
      `Job will be retried in ${delay}ms. Attempt ${attemptNumber}/${maxAttempts}: ${error.message}`
    );
  }
}
```

### Retry Auditing

Each retry is logged with:
- Job ID
- Job type
- Attempt number
- Next delay (in milliseconds)
- Retry strategy (exponential/fixed)

**Audit entry:**
```json
{
  "type": "job_retried",
  "jobType": "generate_response",
  "jobId": "job-123",
  "timestamp": "2026-07-30T15:22:45.000Z",
  "details": {
    "attemptNumber": 2,
    "nextDelayMs": 2000,
    "strategy": "exponential"
  }
}
```

## Dead-Letter Queue (DLQ) Processing

### When Jobs Enter DLQ

1. **Max retries exceeded** — After final retry fails
2. **Non-retryable error** — Immediate on first failure
3. **Timeout exceeded** — Job processing timeout
4. **Worker crash** — Job marked as stalled after timeout

### DLQ Entry Structure

```typescript
interface DeadLetterEntry {
  jobId: string;
  jobType: JobType;
  data: Record<string, unknown>;
  failureReason: string;
  failureCount: number;
  lastFailureTime: Date;
  movedAt: Date;
  expiresAt: Date;  // Auto-deleted after retention period
}
```

### DLQ Cleanup

Entries are automatically cleaned up after the retention period (default: 24 hours).

**Manual cleanup:**
```typescript
import { getDeadLetterQueue } from '@synora/backend/queue';

const dlq = getDeadLetterQueue();

// Remove a specific entry
dlq.removeEntry('job-id');

// Get all entries
const allEntries = dlq.getAllEntries();

// Retry from DLQ
const entry = dlq.retryJob('job-id');
if (entry) {
  // Re-enqueue the job
  const queue = await queueManager.getQueueByJobType(entry.jobType);
  await queue.add(entry.jobType, entry.data, { attempts: 1 });
}
```

## Monitoring Retry Behavior

### Metrics to Track

```typescript
import { getMetricsCollector } from '@synora/backend/queue';

const collector = getMetricsCollector();

// Get queue metrics
const metrics = await collector.collectMetrics('generate_response');

console.log({
  completed: metrics.completed,      // Successfully processed
  failed: metrics.failed,            // Failed (before DLQ)
  waiting: metrics.waiting,          // Awaiting processing
  active: metrics.active,            // Currently processing
  delayed: metrics.delayed,          // Scheduled for retry
});
```

### Alerts

Set up alerts for:

1. **High failure rate** — > 10% jobs failing
2. **DLQ growth** — Rapid increase in dead-letter entries
3. **Retry storms** — Many retry attempts in short time
4. **Worker stalls** — Jobs stuck in active state

### Example Alert Threshold

```typescript
async function checkQueueHealth() {
  const metrics = await collector.collectMetrics('generate_response');
  
  const failureRate = metrics.failed / (metrics.completed + metrics.failed);
  
  if (failureRate > 0.1) {
    alerting.sendAlert({
      severity: 'warning',
      message: `Queue failure rate: ${(failureRate * 100).toFixed(2)}%`,
      queue: 'generate_response',
      metrics,
    });
  }
  
  if (metrics.delayed > 1000) {
    alerting.sendAlert({
      severity: 'critical',
      message: `High number of delayed jobs: ${metrics.delayed}`,
      queue: 'generate_response',
    });
  }
}
```

## Testing Retry Logic

```typescript
import { describe, it, expect } from 'vitest';
import { RetryPolicy } from '@synora/backend/queue';

describe('Retry Logic', () => {
  it('should retry on transient errors', async () => {
    const policy = new RetryPolicy();
    
    const timeoutError = new Error('ETIMEDOUT');
    expect(policy.isRetryableError(timeoutError)).toBe(true);
    expect(policy.shouldRetry(1, timeoutError)).toBe(true);
  });

  it('should not retry on permanent errors', () => {
    const policy = new RetryPolicy();
    
    const validationError = new Error('Invalid input');
    expect(policy.isRetryableError(validationError)).toBe(false);
    expect(policy.shouldRetry(1, validationError)).toBe(false);
  });

  it('should calculate exponential backoff', () => {
    const policy = new RetryPolicy({
      backoffMs: 1000,
      backoffStrategy: 'exponential',
    });

    expect(policy.calculateDelay(1)).toBe(1000);
    expect(policy.calculateDelay(2)).toBe(2000);
    expect(policy.calculateDelay(3)).toBe(4000);
  });

  it('should respect max attempts', () => {
    const policy = new RetryPolicy({ attempts: 3 });
    const error = new Error('ECONNREFUSED');

    expect(policy.shouldRetry(1, error)).toBe(true);
    expect(policy.shouldRetry(2, error)).toBe(true);
    expect(policy.shouldRetry(3, error)).toBe(false);  // Max reached
  });
});
```

## Failure Recovery Workflow

### Scenario 1: Transient Network Error

```
Job: generate_response (attempt 1/3)
↓
Error: ETIMEDOUT
↓
Retry? YES (transient error + attempts remaining)
↓
Delay: 1000ms (exponential backoff)
↓
Audit: job_retried (attempt 2/3)
↓
[Job re-enqueued, waits 1 second]
↓
Job: generate_response (attempt 2/3)
↓
Success → Complete
```

### Scenario 2: Permanent Error

```
Job: generate_response (attempt 1/3)
↓
Error: Invalid conversation ID
↓
Retry? NO (non-retryable error)
↓
Audit: job_failed, job_moved_to_deadletter
↓
DLQ Entry: Created with expiration (24 hours)
↓
Alert: DLQ entry added
↓
Manual Action Required: Review and retry with corrected data
```

### Scenario 3: Max Retries Exceeded

```
Job: generate_response (attempt 1/3)
↓
Error: ECONNREFUSED
↓
Retry (1/3) → Wait 1s → Attempt 2
↓
Error: ECONNREFUSED
↓
Retry (2/3) → Wait 2s → Attempt 3
↓
Error: ECONNREFUSED
↓
Retry? NO (max attempts reached)
↓
Audit: job_failed, job_moved_to_deadletter
↓
DLQ Entry: Created with failure history
↓
Action: Manual retry after investigating service
```

## Best Practices

1. **Design for Idempotency:** Jobs may be retried; ensure safe re-execution
2. **Classify Errors:** Distinguish transient vs. permanent failures
3. **Set Appropriate Timeouts:** Don't retry jobs that timeout indefinitely
4. **Monitor DLQ:** Alert and investigate DLQ growth
5. **Log Context:** Include relevant IDs in error messages for debugging
6. **Test Failure Modes:** Test retry logic with mock failures
7. **Document Non-Retryable Conditions:** Note what errors don't retry
8. **Implement Exponential Backoff:** Prevent thundering herd on service recovery

## Configuration Examples

### Aggressive Retries (CI/Testing)

```typescript
{
  retry: {
    attempts: 5,
    backoffMs: 500,
    backoffStrategy: 'exponential'
  }
}
```

### Conservative Retries (Production, Time-Sensitive)

```typescript
{
  retry: {
    attempts: 2,
    backoffMs: 2000,
    backoffStrategy: 'fixed'
  }
}
```

### Long-Running Jobs

```typescript
{
  retry: {
    attempts: 1,              // No retries for long jobs
    backoffMs: 0,
    backoffStrategy: 'fixed'
  }
}
```
