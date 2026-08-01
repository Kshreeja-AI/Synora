# BullMQ Queue Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

BullMQ is the job queue library built on Redis. Provides reliable async processing with retries, scheduling, priority, and monitoring.

---

## Configuration

```typescript
import { Queue, Worker, QueueScheduler } from 'bullmq';

const queueConfig = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: 3,
  },
};

// Create queues per topic
export const queues = {
  generateResponse: new Queue('generate_response', queueConfig),
  indexMessage: new Queue('index_message_search', queueConfig),
  generateEmbeddings: new Queue('generate_embeddings', queueConfig),
  exportConversation: new Queue('export_conversation', queueConfig),
  scanFileVirus: new Queue('scan_file_virus', queueConfig),
  sendEmail: new Queue('send_email', queueConfig),
  cleanupSoftDeleted: new Queue('cleanup_soft_deleted', queueConfig),
};

// Create workers per topic
export const workers = {
  generateResponse: new Worker('generate_response', generateResponseHandler, {
    connection: queueConfig.connection,
    concurrency: 10,
  }),
  indexMessage: new Worker('index_message_search', indexMessageHandler, {
    connection: queueConfig.connection,
    concurrency: 5,
  }),
  // ... other workers
};

// Scheduler for delayed jobs
const scheduler = new QueueScheduler('generate_response', queueConfig);
```

---

## Job Lifecycle

```
ADDED → WAITING → ACTIVE → COMPLETED
                      ↓
                    FAILED → (retry) → WAITING
                      ↓
                    DELAYED (scheduled)
```

---

## Adding Jobs

```typescript
// Simple job
await queues.generateResponse.add(
  { conversationId, userMessageId },
  { attempts: 3 }
);

// Job with options
await queues.generateResponse.add(
  { conversationId, userMessageId },
  {
    jobId: `gen_${userMessageId}`,  // idempotent key
    priority: 10,                    // higher = sooner
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,  // start at 2s, exponential increase
    },
    removeOnComplete: true,          // auto-delete on success
    removeOnFail: false,             // keep for debugging
    timeout: 120000,                 // 2 minute timeout
    delay: 5000,                     // start after 5s delay
  }
);

// Job with repeat (scheduled)
await queues.cleanupSoftDeleted.add(
  { daysOld: 30 },
  {
    repeat: {
      pattern: '0 2 * * *',  // 2 AM daily
    },
  }
);

// Bulk add
await queues.indexMessage.addBulk([
  { name: 'index', data: { messageId: '1' } },
  { name: 'index', data: { messageId: '2' } },
  { name: 'index', data: { messageId: '3' } },
]);
```

---

## Job Handler

```typescript
async function generateResponseHandler(job: Job) {
  const { conversationId, userMessageId } = job.data;
  
  try {
    // Update progress
    job.progress(0);
    
    // Fetch conversation context
    const context = await buildContext(conversationId);
    job.progress(10);
    
    // Generate via AI
    const stream = await aiProvider.generateStream(context);
    
    let tokenCount = 0;
    for await (const chunk of stream) {
      // Emit token to SSE stream
      await emitToken(conversationId, chunk);
      tokenCount += estimateTokens(chunk);
      
      // Update progress
      const progress = Math.min(90, 10 + (tokenCount / 1000) * 80);
      job.progress(progress);
    }
    
    // Store complete message
    await storeMessage(userMessageId, ...);
    job.progress(100);
    
    return { success: true, tokens: tokenCount };
  } catch (error) {
    if (job.attemptsMade < job.opts.attempts!) {
      // Retry with exponential backoff
      throw error;
    }
    // Final failure - mark message as error
    await markMessageFailed(userMessageId, error.message);
    return { success: false, error: error.message };
  }
}
```

---

## Error Handling

**Automatic Retries:**
```typescript
// Exponential backoff: 2s, 4s, 8s, 16s, ...
backoff: {
  type: 'exponential',
  delay: 2000,
}

// Fixed backoff: always 5s
backoff: {
  type: 'fixed',
  delay: 5000,
}
```

**Manual Error Handling:**
```typescript
worker.on('failed', async (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
  
  // Log to database
  await db.failedJob.create({
    jobId: job.id,
    topic: job.name,
    error: err.message,
    stack: err.stack,
    data: job.data,
    attempts: job.attemptsMade,
  });
  
  // Alert for critical jobs
  if (job.name === 'generate_response' && job.attemptsMade >= 3) {
    await slack.postMessage('#alerts', {
      text: `❌ Message generation failed: ${job.data.messageId}`,
    });
  }
});
```

---

## Job Events

```typescript
worker.on('progress', (job, progress) => {
  console.log(`Job ${job.id} progress: ${progress}%`);
});

worker.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed with result:`, result);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

worker.on('stalled', (job) => {
  console.warn(`Job ${job.id} stalled (likely crashed)`);
});

queue.on('waiting', (job) => {
  console.log(`Job ${job.id} waiting in queue`);
});

queue.on('active', (job) => {
  console.log(`Job ${job.id} started processing`);
});
```

---## Queue Monitoring

```typescript
async function getQueueStats(queue: Queue) {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  
  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed,
  };
}

// Monitor all queues
setInterval(async () => {
  for (const [name, queue] of Object.entries(queues)) {
    const stats = await getQueueStats(queue);
    console.log(`${name}:`, stats);
    
    // Publish to Prometheus
    gauge.queueDepth.set({ queue: name }, stats.waiting);
    gauge.queueActive.set({ queue: name }, stats.active);
  }
}, 30000);  // every 30s
```

---

## Job Persistence

Jobs persist in Redis:

```
Queue data structure:
- Sorted set: job IDs by priority
- Hash: job details (data, options, progress)
- Key pattern: bull:${queue}:${jobId}
```

**Limitations:**
- Data lost if Redis crashes (use RDB persistence)
- No long-term archival (remove completed jobs)

---

## Scaling Strategies

**Scale Up (Single Machine):**
```typescript
// Run multiple workers per topic
const workers = [];
for (let i = 0; i < 5; i++) {
  workers.push(new Worker('generate_response', handler, {
    concurrency: 2,  // 10 total concurrency
  }));
}
```

**Scale Out (Multiple Machines):**
```
Machine 1: Worker (generate_response)
Machine 2: Worker (generate_response)
Machine 3: Worker (index_message_search)
Machine 4: Worker (index_message_search)
Machine 5: Worker (cleanup_soft_deleted)
(all share same Redis instance)
```

**Auto-Scaling (Kubernetes):**
```yaml
spec:
  containers:
  - name: worker-generate-response
    image: synora-worker:latest
    env:
    - name: QUEUE_TOPIC
      value: "generate_response"
    - name: CONCURRENCY
      value: "10"
---
# HPA based on queue depth
metrics:
- type: External
  external:
    metric:
      name: bullmq_queue_depth
      selector:
        matchLabels:
          queue: generate_response
    target:
      type: AverageValue
      averageValue: "100"  # scale when > 100 pending
```

---

## Graceful Shutdown

```typescript
async function shutdownWorker(worker: Worker) {
  console.log('Shutting down worker...');
  
  // Stop accepting new jobs
  await worker.pause();
  
  // Wait for active jobs (max 30s)
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Shutdown timeout')), 30000)
  );
  
  try {
    await Promise.race([worker.waitUntilReady(), timeout]);
    await worker.close();
  } catch (err) {
    console.error('Force closing worker:', err.message);
  }
}

process.on('SIGTERM', async () => {
  for (const worker of Object.values(workers)) {
    await shutdownWorker(worker);
  }
  process.exit(0);
});
```

---

## Testing

- Job enqueues successfully
- Worker processes job
- Progress updates work
- Job retries on failure
- Dead letter queue captures failures
- Metrics recorded
- Graceful shutdown

---

## Performance Targets

- Enqueue: <10ms
- Start processing: <100ms
- Processing time: depends on job type
- Failover/recovery: <30s

---

## Production Checklist

- [ ] Redis backup strategy configured
- [ ] Worker concurrency tuned per topic
- [ ] Retry logic configured
- [ ] Error alerts configured
- [ ] Monitoring/metrics enabled
- [ ] Graceful shutdown implemented
- [ ] DLQ monitoring in place
- [ ] Auto-scaling configured (if K8s)

---

**Status:** Complete
