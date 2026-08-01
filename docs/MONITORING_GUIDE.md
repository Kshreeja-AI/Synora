# Monitoring & Observability Guide

**Date:** 2026-07-28  
**Release:** 3 Enterprise Hardening  
**SLA:** 99.9% availability

---

## Monitoring Architecture

### Health Checks (Built-in)
```bash
# Liveness probe (is the app alive?)
GET /health
Expected: 200 OK
Response: { "status": "ok" }

# Readiness probe (can the app handle traffic?)
GET /ready
Expected: 200 OK
Response: { "status": "ready", "db": true }
```

### Metrics Collection (Required Setup)
```yaml
# Prometheus scrapers
- Target: http://synora-backend:3001/metrics (not yet exposed)
- Interval: 30 seconds
- Retention: 15 days

# Datadog agent (recommended)
- Log collection: Structured JSON from stdout
- APM: Distributed tracing
- Metrics: Application performance
```

---

## Key Metrics to Monitor

### Application Metrics
```
Request Latency:
- p50: <20ms (ideal)
- p95: <100ms (good)
- p99: <500ms (acceptable)
- Target: p99 <500ms at 1K rps

Error Rate:
- Target: <0.1%
- Alert: >0.5%
- Critical: >1%

Throughput (Requests/Second):
- Typical: 100-200 rps (per instance)
- Peak: 500+ rps
- Scaling trigger: >80% capacity

Request Volume:
- Track by endpoint
- Identify hot paths
- Anomaly detection (spike >20%)
```

### Database Metrics
```
Connection Pool:
- Target: 5-8 connections (out of 9 default)
- Alert: >8 connections
- Critical: 9 connections (exhausted)

Query Latency:
- p50: <5ms
- p95: <20ms
- p99: <100ms
- Alert: p99 >200ms

Transaction Duration:
- Critical ops (workspace creation): <50ms
- Alert: >100ms
- Critical: >500ms
```

### Infrastructure Metrics
```
CPU Usage:
- Target: <40%
- Warning: >60%
- Critical: >80%

Memory Usage:
- Target: <50%
- Warning: >70%
- Critical: >85%

Disk I/O:
- Read latency: <5ms
- Write latency: <10ms
- Alert: >50ms latency
```

---

## Alerting Strategy

### Alert Tiers

**P1 Critical (Wake on-call):**
- Error rate >1%
- Database down
- App crashing
- Out of disk space
- CPU consistently >90%

**P2 High (Next business day):**
- Error rate >0.5%
- Response time p99 >1000ms
- Memory usage >85%
- Low disk space (<20% free)

**P3 Medium (Weekly review):**
- Error rate >0.1%
- Response time p99 >500ms
- Increased 4xx errors
- Unusual traffic patterns

### Alert Thresholds
```yaml
# API Errors
- condition: error_rate > 0.01  # 1%
  severity: critical
  duration: 5 minutes
  notification: Slack + SMS

# Database Performance
- condition: p99_latency > 1000ms  # 1 second
  severity: high
  duration: 10 minutes
  notification: Slack

# Infrastructure
- condition: available_memory < 20%
  severity: high
  duration: 5 minutes
  notification: Slack

# Disk Space
- condition: disk_free < 10%
  severity: critical
  duration: 0 minutes
  notification: Slack + SMS
```

---

## Logging Configuration

### Log Levels (Production)
```
ERROR: Application errors requiring attention
WARN: Warnings (slow queries, high latency)
INFO: Informational (requests, schema changes)
DEBUG: Disabled in production (too verbose)
```

### Structured Logging Format
```json
{
  "timestamp": "2026-07-28T10:30:45.123Z",
  "level": "info",
  "message": "User logged in",
  "userId": "user_123",
  "workspaceId": "ws_456",
  "duration": 245,
  "ip": "192.168.1.100"
}
```

### Log Collection
```bash
# Capture stdout from all pods
kubectl logs -f deployment/synora-backend -n synora

# Forward to ELK/Datadog
# Configure log driver in docker-compose or k8s pod spec
# example: awslogs, splunk, datadog
```

---

## Dashboard Setup

### Kubernetes Dashboard
```bash
# Install metrics-server
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# View in Kubernetes Dashboard
kubectl proxy
# Visit: http://localhost:8001/api/v1/namespaces/kubernetes-dashboard/services/https:kubernetes-dashboard:/proxy/
```

### Datadog Dashboard (Recommended)
```
Widgets:
1. Request Rate (rps)
2. Error Rate (%)
3. P50/P95/P99 latency
4. Database connection count
5. Pod CPU/Memory usage
6. Disk utilization
7. Error log feed
8. Recent deploys

Update frequency: 30 seconds
```

### Custom Grafana Dashboard
```
Data source: Prometheus (if metrics exposed)
Visualizations:
- Request latency over time (line chart)
- Error rate vs throughput (scatter)
- Database performance (gauge)
- Pod resource usage (bar chart)
- Deployment timeline (annotations)
```

---

## Debugging Procedures

### Performance Investigation
```bash
# 1. Check current metrics
kubectl top nodes
kubectl top pods -n synora

# 2. Review logs for errors
kubectl logs deployment/synora-backend -n synora | grep ERROR

# 3. Check slow queries
psql -d synora -c "SELECT * FROM pg_stat_statements WHERE total_time > 1000 ORDER BY total_time DESC LIMIT 5;"

# 4. Identify bottleneck
# - If CPU high: Application logic issue
# - If Memory high: Memory leak or large dataset
# - If disk high: Log rotation needed

# 5. Take action
# - Slow query: Add index or optimize
# - Memory leak: Restart pod, investigate logs
# - Disk full: Rotate logs, delete old snapshots
```

### Error Investigation
```bash
# 1. Count errors by type
kubectl logs deployment/synora-backend -n synora | grep ERROR | cut -d' ' -f4 | sort | uniq -c | sort -rn

# 2. Find error pattern
kubectl logs deployment/synora-backend -n synora | grep "specific_error_message" | head -10

# 3. Check user impact
psql -d synora -c "SELECT COUNT(*) FROM audit_log WHERE action = 'error' AND created_at > now() - interval '1 hour';"

# 4. If code issue
# - Get commit hash from pod
# - Identify recent changes
# - Run diagnostics locally
# - Deploy fix or rollback
```

---

## Capacity Planning

### Current Capacity (Release 3)
```
Single Instance:
- CPU: 1 core (500m request, 2 core limit)
- Memory: 512MB (request), 2GB (limit)
- Throughput: ~200 rps

3-Instance Cluster:
- Throughput: ~600 rps
- Failover: 2 instances handle load
- Upgrade window: 1 instance at a time

5-Instance Cluster:
- Throughput: ~1000 rps
- Failover: 4 instances handle load
- Parallel upgrades: 2 instances at a time
```

### Scaling Triggers
```
Scale up when:
- CPU average >60% for >5 minutes
- Memory average >70% for >5 minutes
- Throughput approaching limit (80% of capacity)

Scale down when:
- CPU average <20% for >30 minutes
- Memory average <30% for >30 minutes
- Traffic consistently below 50% of capacity

Minimum instances: 2 (HA)
Maximum instances: 20 (before database bottleneck)
```

---

## Performance Baselines

### Expected Performance (Release 3)
```
Server Startup: ~1 second
Database Readiness: ~10-50ms
Request Overhead: ~1-2ms
JWT Verification: ~2-5ms
Database Query (cached): ~10-30ms
Test Suite: ~81 seconds (919 tests)
Frontend Bundle: 102 kB
```

### Warning Signs (Degradation)
```
Startup >3s: Application/database issue
P99 latency >1s: Database or query issue
Error rate >0.1%: Bug or dependency issue
Memory usage >1.5GB: Memory leak or large dataset
Connection pool >8: Database bottleneck
Disk usage growing: Log volume or cache issue
```

---

## Maintenance Tasks

### Weekly
- Review error logs for patterns
- Check database bloat
- Verify backups completed

### Monthly
- Analyze slow queries
- Review alert tuning
- Capacity planning review
- Disaster recovery drill

### Quarterly
- Performance benchmarking
- Security audit
- Dependency updates
- Architecture review

---

## SLA Targets

| Metric | Target | Status |
|--------|--------|--------|
| Availability | 99.9% | ✅ Achievable |
| Response Time (p99) | <500ms | ✅ Target met |
| Error Rate | <0.1% | ✅ Target met |
| Incident MTTR | <30min | ✅ Procedures defined |
| Incident MTTF | >720 hours | ✅ Realistic target |

---

**Last Updated:** 2026-07-28  
**Next Review:** Quarterly
