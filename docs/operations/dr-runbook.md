# Disaster recovery runbook

## Objectives

| Tier | Description | RTO | RPO |
|---|---|---|---|
| Tier 1 | Postgres primary, Redis, object store | **4 hours** | **15 minutes** |
| Tier 2 | API workers, BullMQ schedulers | 1 hour after Tier 1 | n/a |
| Tier 3 | Frontend SSR, CDN | 30 minutes | n/a |

Tier-1 RPO 15 minutes means at most 15 minutes of transactional data may be
lost in the worst-case regional failure. Tier-2/3 are stateless and rebuild
from git + artifact registry.

## Backup scheme

1. **Postgres** — continuous WAL archiving to object storage + nightly
   `pg_basebackup` + weekly logical dump (`pg_dump -Fc`). Backups are
   encrypted with AES-256-GCM using a key from the secrets vault. Retention:
   WAL 30 days, basebackup 90 days, logical dump 1 year.
2. **Object store (documents)** — object-level versioning + cross-region
   replication with 7-day retention on delete markers.
3. **Offline copy** — monthly full backup copied to a write-once cold-storage
   bucket in a different region. Access controlled by 2-person approval.
4. **Secrets vault** — native snapshot + sealed key shards (Shamir split,
   threshold 3-of-5).

## Restore procedure

1. **Provision** target instance (same major version, same `domera_migrator` /
   `domera_app` role layout — see [tenant-isolation-policy.md](../architecture/tenant-isolation-policy.md)).
2. **Restore basebackup** nearest to the RPO target, then `pg_wal` replay up
   to the desired PITR timestamp.
3. **Apply RLS**: run `node apps/api/prisma/rls/apply-rls.mjs 002_split_roles.sql 001_enable_rls.sql 003_force_rls.sql`.
4. **Rehydrate object store**: sync from latest cross-region replica.
5. **Smoke tests**:
   - `GET /v1/health` → 200
   - `GET /v1/compliance/dashboard` with real tenant id → rows
   - Login as a test user → 200
   - Replay one outbox event manually to verify signature pipeline
6. **Flip DNS** to the restored region; monitor `http_requests_total{status=~"5.."}`
   on the metrics endpoint.

## Quarterly restore drill

- **Q1/Q4**: full production restore into a sandbox VPC. Document
  actual-RTO + actual-RPO, any deviation from the targets above.
- **Q2/Q3**: tabletop exercise only (walk the steps, no actual restore).
- Each drill closes with a post-mortem attached to this doc (append to
  `Drill log` below). Track regressions in the readiness dashboard.

## Drill log

| Date | Type | Target | Actual-RTO | Actual-RPO | Deviations |
|---|---|---|---|---|---|
| _(pending first real drill)_ | | | | | |

## Contacts

- On-call primary: see PagerDuty `domera-oncall-primary`
- On-call secondary: `domera-oncall-secondary`
- Legal (for data-loss disclosure): `legal@` — required within 72h per GDPR Art. 33
