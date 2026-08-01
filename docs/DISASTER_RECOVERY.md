# Disaster Recovery Plan

**Date:** 2026-07-28  
**Release:** 3 Enterprise Hardening  
**RTO:** <30 minutes | **RPO:** <1 hour

---

## Disaster Classification

### P1: Critical (RTO <30min, RPO <1h)
- Database entirely corrupted or deleted
- Complete data center failure
- All instances down
- Security breach

### P2: High (RTO <4h, RPO <24h)
- Partial database corruption
- 50%+ instances down
- Network partition

### P3: Medium (RTO <24h, RPO <24h)
- Single instance failure
- Slow query degradation
- Non-critical feature outage

---

## Data Protection Strategy

### Backup Configuration
```bash
Database Backups:
- Frequency: Every 6 hours (automated)
- Retention: 30 days
- Location: AWS S3 (geo-redundant)
- Type: Full + incremental

Point-in-Time Recovery (PITR):
- WAL archiving: Enabled
- Recovery window: Last 7 days
- Storage: S3

File Storage Backups:
- S3 versioning: Enabled
- Cross-region replication: Enabled
- Lifecycle: Delete old versions after 90 days
```

### Backup Verification
```bash
# Test restore weekly
# 1. Create test database from backup
# 2. Verify data integrity
# 3. Check constraints and indexes
# 4. Destroy test database
# Document results

# Schedule:
# Monday 03:00 UTC - Automated restore test
```

---

## Failover Procedures

### Database Failover
```bash
# If primary PostgreSQL is down:

# 1. Verify primary is truly down
pg_isready -h primary-db.synora.com -p 5432
# Expected: Rejection or timeout

# 2. Promote read replica
aws rds promote-read-replica --db-instance-identifier synora-replica

# 3. Wait for promotion (typically 2-3 minutes)
aws rds describe-db-instances --db-instance-identifier synora-replica \
  --query 'DBInstances[0].[DBInstanceStatus]'

# 4. Update connection string
# Change DATABASE_URL to point to promoted instance

# 5. Restart backend pods
kubectl rollout restart deployment/synora-backend -n synora

# 6. Verify
curl https://api.synora.com/ready

# 7. Notify team
# Post incident in Slack #incidents channel

# 8. Schedule promotion back (when primary restored)
# Do not use old primary as replica until verified
```

### Application Failover
```bash
# If application is crashing:

# 1. Check pod status
kubectl get pods -n synora | grep synora-backend

# 2. Check logs for crash cause
kubectl logs <pod-name> -n synora | tail -100

# 3. If OOM (out of memory)
# → Increase resource limits
# → Scale horizontally

# 4. If code bug
# → Rollback to previous version
# → See Rollback Procedure below

# 5. If dependency issue
# → Restart pod to allow automatic recovery
```

---

## Rollback Procedure

### Application Rollback
```bash
# 1. Identify current version
kubectl get deployment synora-backend -n synora \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# 2. Get previous version
git tag | sort -V | tail -2
# e.g., v3.0.1 (current), v3.0.0 (previous)

# 3. Rollback
kubectl rollout undo deployment/synora-backend -n synora
# OR explicit version:
kubectl set image deployment/synora-backend \
  synora-backend=synora/backend:v3.0.0 -n synora

# 4. Verify
kubectl rollout status deployment/synora-backend -n synora

# 5. Test
curl https://api.synora.com/health
curl https://api.synora.com/ready

# 6. Verify data
# Check that critical operations work (login, create workspace)
```

### Database Rollback
```bash
# If data was corrupted by application:

# 1. Identify issue timestamp
# Review audit logs: SELECT * FROM audit_log WHERE created_at > ...

# 2. Restore from backup before issue
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier synora-restored \
  --db-snapshot-identifier synora-backup-2026-07-28-01-00

# 3. Wait for restore
# Typically 10-20 minutes

# 4. Verify data integrity
# Connect to restored database and spot-check

# 5. After verification, decide:
#    - Option A: Promote restored as primary
#    - Option B: Merge changes forward (if partial corruption)

# 6. If promoting restored:
#    a. Point application to restored database
#    b. Restart backend pods
#    c. Verify all operations
#    d. Monitor for issues

# 7. Audit trail
# Capture: who, what, when, why
# Store in Slack #incidents channel
```

---

## Partial Data Loss Recovery

### Lost or Corrupted Records
```bash
# 1. Query audit trail for last good state
SELECT * FROM audit_log 
WHERE action = 'workspace_created'
AND resource_id = 'ws_123'
ORDER BY created_at DESC;

# 2. Restore from backup to temporary database
# See Database Failover procedure

# 3. Extract missing data
SELECT * FROM workspace WHERE id = 'ws_123' LIMIT 1
# From: synora-restored database

# 4. Re-insert into production
INSERT INTO workspace (id, name, created_by, created_at)
SELECT id, name, created_by, created_at
FROM synora-restored.workspace
WHERE id = 'ws_123'
ON CONFLICT (id) DO NOTHING;

# 5. Verify
SELECT * FROM workspace WHERE id = 'ws_123';

# 6. Cleanup
# Drop temporary database
```

---

## Security Incident Response

### Suspected Breach
```bash
# 1. Immediate actions (First 5 minutes)
# Enable additional logging
kubectl set env deployment/synora-backend \
  LOG_LEVEL=debug -n synora

# Collect evidence
kubectl logs deployment/synora-backend -n synora > incident_logs.txt
psql -d synora -c "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100" > audit_trail.txt

# 2. Investigation (First hour)
# Review auth logs for suspicious logins
psql -d synora -c "SELECT * FROM audit_log WHERE action = 'login' AND created_at > now() - interval '1 day' ORDER BY created_at DESC;"

# Check for unauthorized API access
grep "401\|403" /var/log/synora/access.log

# 3. Containment (If breach confirmed)
# Invalidate all sessions
# UPDATE refresh_token SET revoked = true;
# Force re-login for all users

# Force password reset
# Send reset emails to all admins

# 4. Recovery
# See Password Reset procedure in Runbook

# 5. Post-incident
# Schedule security audit
# Review and improve security practices
```

### Ransomware/Malware Detection
```bash
# 1. Isolate immediately
# Shutdown affected instances
kubectl delete pod <pod-name> -n synora

# 2. Do not attempt recovery until analyzed
# Could spread malware

# 3. Engage security team
# External incident response firm if needed

# 4. Preserve evidence
# Keep logs, memory dumps, disk snapshots

# 5. Restore from clean backup
# Use backup from before infection date
# Verify backup was not infected

# 6. Hardening
# Review security controls
# Update antivirus/detection rules
```

---

## Disaster Recovery Testing

### Monthly Drill Schedule
```
First Saturday each month:
- 04:00 UTC: Database restore test
- 05:00 UTC: Application failover test
- 06:00 UTC: Backup verification

Document:
- Time to completion
- Issues encountered
- Fixes applied
- Lessons learned
```

### Test Checklist
```
Database Restore:
☐ Snapshot created
☐ Restore initiated
☐ Data verified (sample queries)
☐ Constraints checked
☐ Indexes exist
☐ Restore destroyed
☐ Time recorded (target: <20 min)

Application Failover:
☐ Previous version available
☐ Rollback command tested
☐ Health checks pass
☐ Sample requests work
☐ Time recorded (target: <5 min)

File Storage:
☐ S3 restore tested
☐ Cross-region replication working
☐ Version history intact
☐ Time recorded (target: <10 min)
```

---

## Communication Plan

### During Incident
- **Slack:** #incidents channel (real-time updates)
- **Status Page:** statuspage.io (every 15 minutes)
- **Email:** Critical updates to support@synora.com
- **SMS:** P1 incidents (database down)

### Post-Incident
- **Email:** Full postmortem within 24 hours
- **Meeting:** Team retrospective within 48 hours
- **Public:** Blog post (if customer-facing)

### Escalation
```
Level 1: On-call engineer
Level 2: Engineering lead (if >15 min)
Level 3: CTO (if >1 hour)
Level 4: CEO notification (if public data loss)
```

---

## Contact Information

| Role | Name | Phone | Email |
|------|------|-------|-------|
| On-Call | Varies | TBD | TBD |
| Engineering Lead | TBD | TBD | TBD |
| CTO | TBD | TBD | TBD |
| Database Admin | TBD | TBD | TBD |
| Security Team | TBD | TBD | TBD |

---

## RTO/RPO Commitments

**Supported Recovery Scenarios:**

| Scenario | RTO | RPO | Status |
|----------|-----|-----|--------|
| Single pod failure | <5 min | 0 | ✅ Kubernetes auto-restart |
| Single node failure | <10 min | 0 | ✅ Pod rescheduling |
| Database primary down | <30 min | <1h | ✅ Read replica failover |
| Full cluster failure | <1h | <1h | ✅ Restore from backup |
| Regional outage | <4h | <4h | ⚠️ Requires pre-setup |

---

## Limitations

**What we DO protect against:**
- ✅ Hardware failures (disk, network)
- ✅ Software crashes
- ✅ Accidental data deletion
- ✅ Database corruption
- ✅ Single region outage

**What requires additional setup:**
- ⚠️ Multi-region failover (requires cross-region replication)
- ⚠️ DDoS (requires WAF)
- ⚠️ Ransomware (requires air-gapped backups)
- ⚠️ 99.99% uptime (requires dual-region active-active)

---

**Last Updated:** 2026-07-28  
**Next Drill:** First Saturday of next month
