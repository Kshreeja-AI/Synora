# Observability Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Comprehensive logging, metrics collection, tracing, and alerting. Enables production monitoring, debugging, and performance optimization.

---

## Logging Strategy

**Structured JSON Logging:**

```typescript
logger.info('conversation_created', {
  conversationId: 'conv_123',
  workspaceId: 'ws_123',
  userId: 'user_123',
  title: 'API Design',
  duration_ms: 45,
  timestamp: '2026-07-28T14:30:00Z',
  requestId: 'req_789',
  version: '3.0.0'
});
```

**Log Levels:**
- ERROR: Exceptions, failures, alert-worthy
- WARN: Degraded behavior, retries, edge cases
- INFO: User actions, state changes, milestones
- DEBUG: Internal state, data flow (dev only)

**Log Destinations:**
- Console (development)
- ELK Stack / Datadog (production)
- CloudWatch / similar (cloud)

---

## Metrics (Prometheus)

**Counters:**
```
conversation_created_total{workspace_id, user_id}
message_generated_total{provider, model, status}
user_joined_total{conversation_id}
api_requests_total{endpoint, method, status}
errors_total{type, severity}
```

**Histograms:**
```
api_request_duration_ms{endpoint, method}
database_query_duration_ms{query, percentile}
message_generation_duration_ms{model, percentile}
search_latency_ms{type, percentile}
```

**Gauges:**
```
active_conversations{workspace_id}
pending_jobs{topic}
redis_memory_used_bytes
elasticsearch_cluster_health{status}
websocket_connections_active
database_connections_in_use
```

---

## Tracing (OpenTelemetry)

**Trace Context:**
- Request ID: unique per API request
- Correlation ID: tracks across services
- Span hierarchies: trace request → service → database

```typescript
const span = tracer.startSpan('message_generation', {
  attributes: {
    'conversation.id': conversationId,
    'message.id': messageId,
    'model': model,
    'tokens.input': inputTokens
  }
});
```

---

## Alerts & Rules

| Alert | Condition | Action |
|-------|-----------|--------|
| High Error Rate | >5% of requests fail | Page on-call |
| Slow API | P99 latency > 1s | Investigate |
| Database Lag | Query latency > 500ms | Scale DB |
| Memory Leak | Memory growth > 100MB/hr | Restart service |
| Redis Down | Connection failures | Failover |
| Cost Spike | Daily spend > 150% normal | Notify finance |

---

## Dashboards

**System Health:**
- API latency (P50, P95, P99)
- Error rate by endpoint
- Database connections
- Redis memory usage
- Queue depth by topic

**Business Metrics:**
- Conversations created (daily)
- Total messages (daily)
- Total tokens (daily)
- Total cost (daily)
- User growth

**Performance:**
- Message generation time
- Search latency
- Stream token latency
- File upload throughput

---

## Health Checks

```
GET /health
Response 200: {
  status: "healthy",
  timestamp: "2026-07-28T14:30:00Z",
  components: {
    database: "ok",
    redis: "ok",
    elasticsearch: "ok"
  }
}

GET /ready
Response 200: { ready: true }
OR
Response 503: { ready: false, reason: "database unavailable" }
```

---

## Error Tracking (Sentry)

**Enabled for:**
- Unhandled exceptions
- API errors (5xx)
- Background job failures
- Async operation crashes

**Captured Data:**
- Stack trace
- Request context
- User ID
- Environment
- Version

**Not Captured:**
- Passwords or API keys
- Personal user data (PII)
- Request bodies (sanitized)

---

## Audit Logging

Immutable append-only log:

```json
{
  "timestamp": "2026-07-28T14:30:00Z",
  "action": "conversation_created",
  "userId": "user_123",
  "workspaceId": "ws_123",
  "resourceType": "Conversation",
  "resourceId": "conv_123",
  "before": null,
  "after": { "title": "...", "description": "..." },
  "requestId": "req_789",
  "ipAddress": "192.168.1.1"
}
```

**Retention:** 7 years (for compliance)

---

## Performance Profiling

**Enabled for:**
- Slow API endpoints (>500ms)
- Heavy database queries
- Memory-intensive operations
- CPU-bound tasks

**Tools:**
- Node.js profiler (clinic.js)
- Flame graphs (0x)
- Memory snapshots (heap dumps)

---

## Incident Response

**On Error Alert:**
1. Automated page to on-call
2. Error details in alert
3. Runbook link (if available)
4. Slack notification with context
5. Auto-create incident in PagerDuty

**Post-Incident:**
1. Post-mortem within 24hrs
2. Root cause analysis
3. Action items + assignments
4. Prevention measures

---

## Log Retention

| Log Type | Retention | Storage |
|----------|-----------|---------|
| Application logs | 30 days | CloudWatch / ELK |
| Audit logs | 7 years | S3 (Glacier) |
| Metrics | 1 year | Prometheus |
| Traces | 7 days | Jaeger / Datadog |

---

## Compliance & Privacy

- No PII in logs (emails hashed)
- Sensitive data redacted (tokens, passwords)
- GDPR compliance (delete old logs)
- Access control (who can view logs)
- Encryption at rest (audit logs)

---

## Testing Observability

**Unit Tests:**
- Log output captured and verified
- Metrics incremented correctly
- Error handling logged

**Integration Tests:**
- Full request trace generated
- All metrics recorded
- Audit log entries created

**Load Tests:**
- Observe under high load
- Latency percentiles P50/P95/P99
- Error rate under stress
- Resource utilization (CPU, memory, disk)

---

## Configuration

```typescript
const observability = {
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'json',
    destinations: ['console', 'elk'],
  },
  metrics: {
    enabled: true,
    port: 9090,
    path: '/metrics',
  },
  tracing: {
    enabled: process.env.ENV === 'production',
    sampleRate: 0.1,
    exportInterval: 60000,
  },
  sentry: {
    enabled: process.env.ENV === 'production',
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  },
};
```

---

## Future Enhancements

- Real-time alerting dashboard
- Anomaly detection (ML-based)
- Custom dashboards per team
- Cost attribution per user/project
- SLO tracking and reporting
- Synthetic monitoring (uptime checks)

---

**Status:** Complete
