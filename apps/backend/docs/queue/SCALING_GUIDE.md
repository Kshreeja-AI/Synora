# Queue Scaling Guide

## Architecture Overview

The queue system is designed for horizontal scaling with the following components:

1. **Shared Redis** — Central message broker (single instance per environment)
2. **Multiple Worker Processes** — Stateless job processors (scale horizontally)
3. **Job Definitions** — Shared configuration (same across all processes)
4. **Metrics & Monitoring** — Centralized tracking (Redis-backed)

## Scaling Strategies

### Strategy 1: Vertical Scaling (Single Process)

Increase concurrency within a single Node.js process.

**Pros:**
- Simple setup
- Minimal latency
- Shared memory for caching

**Cons:**
- Limited by single process memory
- Single point of failure
- CPU-bound if too many concurrent jobs

**Configuration:**
```typescript
{
  queue: {
    workers: {
      generateResponse: 10,        // Increase from 5
      indexMessageSearch: 5,       // Increase from 2
      generateEmbeddings: 5,       // Increase from 2
      processFile: 8,              // Increase from 3
      cleanup: 2,                  // Increase from 1
      notification: 5,             // Increase from 2
    }
  }
}
```

**Limitations:**
- Node.js is single-threaded
- Max 30-50 concurrent jobs per process before performance degrades
- Memory grows with concurrent job count (~50MB per concurrent job average)

### Strategy 2: Horizontal Scaling (Multiple Processes)

Run multiple worker processes, each with moderate concurrency.

**Pros:**
- No single point of failure
- Better resource utilization
- Easier to scale up/down
- Process isolation

**Cons:**
- More infrastructure complexity
- Network latency to Redis
- Requires monitoring

**Architecture:**
```
Load Balancer
    ↓
├─ Worker Process 1 (5 generate_response workers)
├─ Worker Process 2 (5 generate_response workers)
├─ Worker Process 3 (5 generate_response workers)
├─ Worker Process 4 (2 index_message_search workers)
├─ Worker Process 5 (2 index_message_search workers)
│
└─ Shared Redis
```

**Deployment example (Kubernetes):**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: synora-queue-workers
spec:
  replicas: 5
  template:
    spec:
      containers:
      - name: worker
        image: synora/backend:latest
        env:
        - name: WORKER_JOBS
          value: "generate_response,index_message_search"
        - name: QUEUE_WORKER_GENERATE_RESPONSE
          value: "5"
        - name: QUEUE_WORKER_INDEX_MESSAGE_SEARCH
          value: "2"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
```

### Strategy 3: Job Type Specific Scaling

Deploy dedicated workers for each job type based on demand.

**Pros:**
- Precise resource allocation
- Job type isolation
- Easy to prioritize

**Cons:**
- More complex deployment
- Resource fragmentation

**Configuration:**
```yaml
Worker Tier 1 (Response Generation):
  - 10 replicas × 5 concurrent = 50 total workers
  - Memory: 1GB per process
  - CPU: 2 cores per process

Worker Tier 2 (Indexing):
  - 3 replicas × 5 concurrent = 15 total workers
  - Memory: 512MB per process
  - CPU: 1 core per process

Worker Tier 3 (Embeddings):
  - 3 replicas × 5 concurrent = 15 total workers
  - Memory: 512MB per process
  - CPU: 1 core per process

Worker Tier 4 (File Processing):
  - 5 replicas × 3 concurrent = 15 total workers
  - Memory: 1GB per process (for file buffers)
  - CPU: 1 core per process
```

## Capacity Planning

### Job Processing Rate Calculation

```
Total Throughput = Σ(Worker Concurrency × Processing Speed)

For generate_response:
  - 5 workers × 1.5 jobs/sec = 7.5 jobs/sec
  - 10 workers × 1.5 jobs/sec = 15 jobs/sec
  - 20 workers × 1.5 jobs/sec = 30 jobs/sec
```

### Memory Planning

```
Base Memory per Process: 150MB

Per Concurrent Job: 50MB (average)

Total: 150MB + (50MB × concurrent_count)

Example: 5 concurrent jobs
  150MB + (50MB × 5) = 400MB
```

### Resource Requirements

| Job Type | Per Worker | Concurrency | Total Memory | CPU per Job |
|----------|-----------|------------|--------------|------------|
| generate_response | 150MB base | 5 | 400MB | 200ms @ 100% |
| index_message_search | 150MB base | 5 | 400MB | 100ms @ 50% |
| generate_embeddings | 150MB base | 3 | 300MB | 500ms @ 100% |
| process_file | 150MB base | 3 | 300MB | 1000ms @ 100% |
| cleanup | 150MB base | 1 | 200MB | 5000ms @ 20% |
| notification | 150MB base | 2 | 250MB | 50ms @ 10% |

## Performance Tuning

### 1. Redis Connection Pooling

```typescript
{
  queue: {
    redis: {
      maxRetriesPerRequest: null,    // Use connection pooling
      enableReadyCheck: true,
      enableOfflineQueue: true,
    }
  }
}
```

### 2. Batch Job Processing

For indexing and embeddings, batch jobs:

```typescript
// Instead of processing 1000 messages individually
// Batch process them in groups of 100

interface BatchIndex Job {
  messageIds: string[];  // Process 100 at a time
}
```

### 3. Priority Queues

Higher priority jobs should process faster:

```typescript
// Urgent response generation
queue.add('generate_response', data, {
  priority: 1,           // Higher priority
  attempts: 3,
});

// Background indexing
queue.add('index_message_search', data, {
  priority: 10,          // Lower priority
  attempts: 2,
});
```

### 4. Job Timeouts

Prevent runaway jobs:

```typescript
{
  generate_response: {
    timeout: 60000,      // 60 seconds max
  },
  process_file: {
    timeout: 120000,     // 2 minutes for files
  },
  cleanup: {
    timeout: 300000,     // 5 minutes for maintenance
  },
}
```

## Monitoring and Alerting

### Key Metrics

```typescript
interface QueueMetrics {
  waiting: number;        // Jobs queued, not yet processing
  active: number;         // Currently processing
  completed: number;      // Successfully processed (today)
  failed: number;         // Failed before moving to DLQ
  delayed: number;        // Scheduled for retry/future
}
```

### Scaling Triggers

**Scale UP when:**
- `waiting > completed × 0.5` (queue backing up)
- `waiting > 1000` (large queue)
- `average_processing_time > threshold` (getting slow)

**Scale DOWN when:**
- `waiting < 100` (queue mostly empty)
- `active < desired_concurrency × 0.3` (underutilized)
- `cpu_usage < 20%` (idle capacity)

### Example Scaling Rules

```typescript
// Auto-scaling logic for Kubernetes
const metrics = await collector.collectMetrics('generate_response');

if (metrics.waiting > 2000) {
  // Scale up: increase replicas
  scaleDeployment('queue-workers-gen-response', currentReplicas + 2);
} else if (metrics.waiting < 100 && metrics.active < 10) {
  // Scale down: decrease replicas
  scaleDeployment('queue-workers-gen-response', currentReplicas - 1);
}
```

## Redis Scaling

### Single Redis Instance (Development)

```
Redis Single Instance
    ↓
All Workers Connected
```

**Limit:** ~50K jobs/sec, 500 concurrent connections

### Redis Sentinel (High Availability)

```
Redis Master (write)
    ↓
├─ Redis Slave 1 (read)
├─ Redis Slave 2 (read)
└─ Sentinel (monitoring)
```

**Failover:** Automatic promotion on master failure

### Redis Cluster (Horizontal Scaling)

```
Cluster Node 1 (hash slots 0-5460)
Cluster Node 2 (hash slots 5461-10922)
Cluster Node 3 (hash slots 10923-16383)
```

**Limit:** ~300K jobs/sec, unlimited horizontal scaling

### Configuration

**Single Redis (development):**
```
QUEUE_REDIS_URL=redis://localhost:6379
```

**Sentinel (staging):**
```
QUEUE_REDIS_SENTINELS=sentinel-1:26379,sentinel-2:26379,sentinel-3:26379
QUEUE_REDIS_SENTINEL_NAME=mymaster
```

**Cluster (production):**
```
QUEUE_REDIS_CLUSTER_NODES=node-1:6379,node-2:6379,node-3:6379
```

## Load Testing

### Throughput Test

```typescript
async function loadTest() {
  const queue = await queueManager.getQueueByJobType('generate_response');
  
  console.time('load-test');
  
  for (let i = 0; i < 10000; i++) {
    await queue?.add('generate_response', {
      conversationId: `conv-${i}`,
      messageId: `msg-${i}`,
    });
  }
  
  console.timeEnd('load-test');
  // Measure: time to enqueue 10K jobs
  // Target: < 5 seconds
}
```

### Latency Test

```typescript
async function latencyTest() {
  const start = Date.now();
  
  const job = await queue?.add('generate_response', {
    conversationId: 'test-conv',
  });
  
  // Wait for completion
  await job?.finished();
  
  const latency = Date.now() - start;
  console.log(`Job latency: ${latency}ms`);
  // Target: < 5 seconds for generate_response
}
```

## Troubleshooting Scaling Issues

### Problem: Jobs not processing

1. Check Redis connection
2. Verify worker count: `queueManager.workers.size`
3. Check job registration: `getJobRegistry().getJobDefinition()`
4. Review worker logs for errors

### Problem: Memory grows unbounded

1. Check for job data leaks (store IDs, not full objects)
2. Monitor worker.activeJobs count
3. Verify cleanup on completion
4. Check for circular references in job data

### Problem: Uneven load distribution

1. Verify all workers healthy
2. Check job type registration
3. Monitor queue depth per worker
4. Consider priority-based processing

### Problem: High latency

1. Check Redis latency: `getRedis().ping()`
2. Monitor job processing time distribution
3. Look for blocking operations in handlers
4. Increase worker concurrency if not CPU-bound
