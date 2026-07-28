# Operations Runbook

**Date:** 2026-07-28  
**Release:** 3 Enterprise Hardening  
**Audience:** DevOps, SRE, On-Call Engineers

---

## Daily Operations

### Morning Health Check (Every Day)
```bash
# 1. Check deployment status
kubectl get pods -n synora | grep synora-backend
# Expected: All pods Running

# 2. Check error rate
curl https://api.synora.com/health
# Expected: 200 OK

# 3. Check database connectivity
curl https://api.synora.com/ready
# Expected: 200 OK, db: true

# 4. Review error logs
kubectl logs --tail=100 deployment/synora-backend -n synora | grep error
# Expected: No ERROR level entries

# 5. Check resource usage
kubectl top nodes
kubectl top pods -n synora
# Expected: CPU <60%, Memory <70%
```

### Weekly Tasks
- Review deployment updates (Dependabot PRs)
- Audit access logs for suspicious activity
- Backup verification (restore test)
- Database statistics update: `ANALYZE;`

---

## Common Procedures

### Deploy New Version
```bash
# 1. Test in staging first
kubectl apply -f deployment.yaml -n staging

# 2. Tag release
git tag -a v3.0.1 -m "Production release"
git push origin v3.0.1

# 3. Build and push image
docker build -t synora/backend:v3.0.1 .
docker push synora/backend:v3.0.1

# 4. Update Kubernetes deployment
kubectl set image deployment/synora-backend \
  synora-backend=synora/backend:v3.0.1 -n synora

# 5. Monitor rollout
kubectl rollout status deployment/synora-backend -n synora

# 6. Verify
curl https://api.synora.com/health
```

### View Logs
```bash
# Real-time backend logs
kubectl logs -f deployment/synora-backend -n synora

# Last 100 lines
kubectl logs --tail=100 deployment/synora-backend -n synora

# Filter for errors
kubectl logs deployment/synora-backend -n synora | grep ERROR

# Specific container
kubectl logs deployment/synora-backend -c app -n synora
```

### Scale Service
```bash
# Increase replicas
kubectl scale deployment synora-backend --replicas=5 -n synora

# Check status
kubectl get pods -n synora

# Monitor scaling
watch kubectl get pods -n synora
```

### Restart Service
```bash
# Graceful restart (30s drain period)
kubectl rollout restart deployment/synora-backend -n synora

# Force restart (immediate)
kubectl delete pod <pod-name> -n synora

# Verify
kubectl get pods -n synora
```

---

## Database Operations

### Connect to Database
```bash
# From pod
kubectl exec -it <pod-name> -n synora -- psql $DATABASE_URL

# From local (if accessible)
psql "postgresql://user:pass@db.synora.com:5432/synora"
```

### Database Maintenance
```bash
# Analyze tables
psql -d synora -c "ANALYZE;"

# Vacuum (cleanup)
psql -d synora -c "VACUUM ANALYZE;"

# Check table sizes
psql -d synora -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"

# Check index usage
psql -d synora -c "SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0 LIMIT 10;"
```

### Check Database Backups
```bash
# AWS RDS backups
aws rds describe-db-snapshots \
  --db-instance-identifier synora-primary \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime]'

# Local backups
ls -lh /backups/synora/ | tail -10
```

---

## Troubleshooting

### High Error Rate
```bash
# 1. Check logs
kubectl logs -f deployment/synora-backend -n synora

# 2. Check metrics
# - CPU usage: Too high?
# - Memory: Leaking?
# - Database connections: Exhausted?

# 3. If database issue
kubectl exec -it <pod-name> -n synora -- \
  psql -d synora -c "SELECT count(*) FROM pg_stat_activity;"

# 4. If out of memory
kubectl describe pod <pod-name> -n synora | grep -A 5 "Last State"

# 5. Restart if needed
kubectl rollout restart deployment/synora-backend -n synora
```

### Slow Responses
```bash
# 1. Check request latency in logs
kubectl logs deployment/synora-backend -n synora | grep "duration"

# 2. Identify slow queries (if logging enabled)
# SELECT * FROM pg_stat_statements WHERE total_time > 1000;

# 3. Check database connection count
psql -d synora -c "SELECT count(*) FROM pg_stat_activity;"

# 4. Increase connections if needed
# Modify PostgreSQL config max_connections

# 5. Add database index if query identified
# CREATE INDEX ON table(column);
```

### Database Connection Exhaustion
```bash
# 1. Check current connections
psql -d synora -c "SELECT datname, usename, count(*) FROM pg_stat_activity GROUP BY datname, usename;"

# 2. Kill idle connections
psql -d synora -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '1 hour';"

# 3. Increase pool size in Kubernetes
# Edit deployment.yaml: CONNECTION_LIMIT=20

# 4. Restart pods to pick up new setting
kubectl rollout restart deployment/synora-backend -n synora
```

### Out of Disk Space
```bash
# 1. Check disk usage
df -h /data

# 2. Identify large files
find /data -type f -size +1G -exec ls -lh {} \;

# 3. Clean old logs
find /var/log/synora -mtime +30 -delete

# 4. Truncate database logs if needed
psql -d synora -c "TRUNCATE pg_log;"
```

---

## Alerting Response

### P1 Alert: Errors >5%
```bash
# 1. Declare incident
# Slack: Start incident in #incidents

# 2. Check status
curl https://api.synora.com/health
curl https://api.synora.com/ready

# 3. Review logs
kubectl logs -f deployment/synora-backend -n synora

# 4. If database issue
# → Database Recovery procedure (see DISASTER_RECOVERY.md)

# 5. If application crash
# → Restart deployment
kubectl rollout restart deployment/synora-backend -n synora

# 6. If code issue
# → Rollback to previous version (see DEPLOYMENT_GUIDE.md)

# 7. Post-incident review
# Schedule meeting within 24 hours
```

### P2 Alert: Response Time >500ms
```bash
# 1. Check CPU/Memory
kubectl top pods -n synora

# 2. Scale up if high resource usage
kubectl scale deployment synora-backend --replicas=7 -n synora

# 3. Check database queries
# Slow query log analysis

# 4. Monitor for 15 minutes
watch kubectl top pods -n synora
```

---

## Security Operations

### Rotate Secrets
```bash
# 1. Generate new JWT_SECRET
openssl rand -base64 32

# 2. Update in secrets manager
kubectl patch secret backend-secrets -p \
  '{"data":{"JWT_SECRET":"'$(echo -n $NEW_SECRET | base64)'"}}'

# 3. Restart pods (pick up new secret)
kubectl rollout restart deployment/synora-backend -n synora

# 4. Verify
curl https://api.synora.com/health
```

### Review Audit Logs
```bash
# Check recent actions
psql -d synora -c "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;"

# Check for suspicious activity
psql -d synora -c "SELECT user_id, COUNT(*) FROM audit_log WHERE created_at > now() - interval '1 hour' GROUP BY user_id ORDER BY count DESC;"

# Export for compliance
psql -d synora -c "COPY audit_log TO '/backups/audit_export.csv' WITH CSV HEADER;"
```

### Reset User Password
```bash
# Generate reset token
# Send via email to user

# User completes reset flow via web UI
# Verify in audit logs
psql -d synora -c "SELECT * FROM audit_log WHERE action = 'password_reset' ORDER BY created_at DESC LIMIT 1;"
```

---

## Performance Tuning

### Enable Query Logging
```bash
# PostgreSQL log_statement
# log_statement = 'all' (expensive, development only)
# log_statement = 'mod' (modifications only)
# log_min_duration_statement = 100 (log queries >100ms)
```

### Optimize Slow Query
```bash
# 1. Identify query
# EXPLAIN ANALYZE SELECT ...

# 2. Create index if needed
# CREATE INDEX idx_workspaces_created ON workspaces(created_at DESC);

# 3. Verify improvement
# EXPLAIN ANALYZE SELECT ... (second time)

# 4. Monitor
kubectl logs deployment/synora-backend -n synora | grep "duration:"
```

---

## Maintenance Windows

### Planned Maintenance (Announce 1 Week Prior)
```
Scheduled: Saturdays 02:00-04:00 UTC
Expected downtime: <15 minutes
Impact: API unavailable, users will see error page
```

**Procedure:**
1. Post maintenance notice 1 week before
2. Post reminder 24 hours before
3. At maintenance time:
   - Drain traffic (stop accepting new requests)
   - Perform maintenance (database backup, updates, etc.)
   - Restart services
   - Verify health probes
4. Post completion notice

---

## On-Call Escalation

**Tier 1 (You - First 15 minutes)**
- Health check
- Review logs
- Basic troubleshooting
- Restart service if safe

**Tier 2 (Engineering Lead - If not resolved)**
- Code-level debugging
- Database analysis
- Potential code rollback
- Call: +1-xxx-xxx-xxxx

**Tier 3 (CTO - Critical incident)**
- Major outage (>30 minutes)
- Data loss risk
- Security incident
- Call: +1-xxx-xxx-xxxx

---

**Last Updated:** 2026-07-28  
**Next Review:** Monthly
