# Background Workers Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Async job processing via Bull queue. Handles message generation, indexing, exports, notifications, and cleanup tasks without blocking API requests.

---

## Worker Architecture

**Job Queue Topics:**

| Topic | Priority | Concurrency | Purpose | Timeout |
|-------|----------|-------------|---------|---------|
| generate_response | HIGH | 10 | AI message generation | 120s |
| index_message_search | NORMAL | 5 | Elasticsearch indexing | 30s |
| generate_embeddings | NORMAL | 5 | Vector DB indexing | 30s |
| export_conversation | LOW | 2 | Markdown/PDF export | 60s |
| scan_file_virus | NORMAL | 3 | ClamAV virus scanning | 60s |
| send_email | NORMAL | 5 | Transactional email | 10s |
| cleanup_soft_deleted | LOW | 1 | Hard-delete expired | 300s |
| reindex_workspace | LOW | 1 | Full search reindex | 600s |

---

## Job Definition

```typescript
interface Job<T> {
  id: string;
  name: string;
  data: T;
  opts: {
    attempts: number;
    backoff: { type: 'exponential'; delay: number };
    removeOnComplete: boolean;
    removeOnFail: boolean;
    timeout: number;
  };
  progress: number;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  failedReason?: string;
  stacktrace?: string[];
  attemptsMade: number;
  timestamp: number;
}
```

---

## Job Handlers

```typescript
// generate_response: Create AI message
queue.process('generate_response', 10, async (job) => {
  const { conversationId, userMessageId, branchId } = job.data;
  
  job.progress(0);
  
  try {
    const context = await fetchContext(conversationId);
    job.progress(10);
    
    const stream = await ai.generateStream(context);
    job.progress(20);
    
    let tokens = 0;
    for await (const chunk of stream) {
      await emitToken(conversationId, chunk);
      tokens += chunk.length / 4;  // rough estimate
      job.progress(Math.min(90, 20 + (tokens / 1000) * 70));
    }
    
    job.progress(100);
    return { success: true };
  } catch (error) {
    if (job.attemptsMade < 3) {
      throw error;  // retry
    }
    await markMessageFailed(userMessageId, error.message);
  }
});

// index_message_search: Add to Elasticsearch
queue.process('index_message_search', 5, async (job) => {
  const { messageId } = job.data;
  const message = await db.message.findUnique({ where: { id: messageId } });
  await elasticsearch.index({
    index: `messages-${message.conversation.workspaceId}`,
    id: messageId,
    body: {
      conversationId: message.conversationId,
      content: message.content,
      role: message.role,
      createdAt: message.createdAt,
    }
  });
});

// cleanup_soft_deleted: Hard-delete expired
queue.process('cleanup_soft_deleted', 1, async (job) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const expired = await db.conversation.findMany({
    where: { isDeleted: true, deletedAt: { lt: thirtyDaysAgo } },
    take: 1000
  });
  
  for (const conv of expired) {
    // Delete files from S3
    await s3.deletePrefix(`conversations/${conv.id}/`);
    // Delete from Elasticsearch
    await elasticsearch.deleteByQuery({
      index: `messages-${conv.workspaceId}`,
      query: { term: { conversationId: conv.id } }
    });
    // Delete from DB (cascades)
    await db.conversation.delete({ where: { id: conv.id } });
    
    job.progress(expired.indexOf(conv) / expired.length * 100);
  }
});
```

---

## Retry Strategy

```typescript
const retryConfig = {
  generate_response: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 }  // 2s, 4s, 8s
  },
  index_message_search: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  },
  send_email: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 }
  },
};
```

---

## Enqueuing Jobs

```typescript
// In conversation service:
await queue.add('generate_response', {
  conversationId,
  userMessageId,
  branchId,
}, {
  priority: 'high',
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: true,
  jobId: `gen_${userMessageId}`,  // idempotent key
});
```

---

## Job Monitoring

```typescript
// Job events
queue.on('completed', (job) => {
  logger.info('job_completed', { jobId: job.id, topic: job.name });
});

queue.on('failed', (job, err) => {
  logger.error('job_failed', {
    jobId: job.id,
    topic: job.name,
    attempts: job.attemptsMade,
    error: err.message,
    stack: err.stack,
  });
  
  // Alert if critical
  if (job.name === 'generate_response' && job.attemptsMade >= 3) {
    await slack.postMessage('#incidents', {
      text: `❌ Message generation failed after 3 retries: ${job.data.messageId}`
    });
  }
});

queue.on('progress', (job, progress) => {
  logger.debug('job_progress', { jobId: job.id, progress });
});
```

---

## Graceful Shutdown

```typescript
async function gracefulShutdown() {
  console.log('Shutting down workers...');
  
  // Stop accepting new jobs
  await queue.pause();
  
  // Wait for active jobs to complete (5s timeout)
  const timeoutId = setTimeout(() => {
    console.warn('Force closing workers after timeout');
  }, 5000);
  
  // Close queue
  await queue.close();
  clearTimeout(timeoutId);
  
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

---

## Dead Letter Queue

Failed jobs after max attempts go to DLQ:

```typescript
queue.on('failed', async (job, err) => {
  if (job.attemptsMade >= job.opts.attempts) {
    await db.failedJob.create({
      topic: job.name,
      jobData: job.data,
      error: err.message,
      stack: err.stack,
      timestamp: new Date(),
    });
  }
});

// Manual retry from DLQ
async function retryFailedJob(failedJobId: string) {
  const failed = await db.failedJob.findUnique({ where: { id: failedJobId } });
  await queue.add(failed.topic, failed.jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
  await db.failedJob.delete({ where: { id: failedJobId } });
}
```

---

## Scaling Strategy

**Deployment:**
```dockerfile
# Per topic, run N worker pods
docker run synora-worker --topic generate_response --concurrency 10
docker run synora-worker --topic index_message_search --concurrency 5
docker run synora-worker --topic cleanup_soft_deleted --concurrency 1
```

**Auto-scaling (Kubernetes):**
```yaml
HorizontalPodAutoscaler:
  targetAverageQueueDepth: 100
  minReplicas: 2
  maxReplicas: 10
  scaleUpThreshold: 500 jobs pending
  scaleDownThreshold: 50 jobs pending
```

---

## Monitoring & Alerts

| Metric | Alert | Threshold |
|--------|-------|-----------|
| Queue depth | Backlog growing | > 1000 pending jobs |
| Job latency | Slow processing | P95 > 30s |
| Error rate | High failure | > 5% failing |
| Memory usage | Memory leak | > 1GB growth/hr |
| Worker health | Worker crashed | No active workers |

---

## Testing

- Job enqueues successfully
- Job executes and completes
- Job retries on failure
- Job fails after max attempts
- Progress updates work
- DLQ captures failed jobs
- Graceful shutdown waits for jobs
- Concurrent workers don't conflict

---

## Performance Targets

- generate_response: <120s (AI provider dependent)
- index_message_search: <5s
- send_email: <2s
- cleanup_soft_deleted: <600s for 1000 items

---

## Security

- Job data logged (sanitized)
- Secrets never in job data
- Access control: admins only can retry
- Audit trail of failed jobs

---

## Disaster Recovery

**Data Loss Prevention:**
- Redis persistence (RDB snapshots)
- Redis replication (master-slave)
- DLQ for audit trail

**Recovery Procedure:**
1. Identify failed jobs (DLQ)
2. Fix root cause (code, provider, etc.)
3. Manually retry via API or console
4. Monitor retry completion

---

**Status:** Complete
