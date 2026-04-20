# Tenant isolation policy

Canonical tenancy model for Domera. Aligned with SSOT §5 and §10.

## Default: shared database, row-level isolation

- One PostgreSQL cluster, one schema, one Prisma client per process.
- Every tenant-scoped row carries `tenant_id`.
- PostgreSQL **RLS** policy `<table>_tenant_isolation` on each tenant-scoped
  table. Policy reads `current_setting('app.current_tenant_id', true)` and
  compares against the row's `tenant_id`. Missing setting → default-deny.
- Runtime application role (`domera_app`) is `NOBYPASSRLS`. Migrator role
  (`domera_migrator`) owns the schema and has `BYPASSRLS` for migrations +
  seeds.
- Every HTTP request's transaction executes
  `select set_config('app.current_tenant_id', <uuid>, true)` before issuing
  business queries. Transaction-local scope ensures the value never leaks
  between requests.

This model is the default for all tenants and covers: MVP, startup customers,
mid-market clients with normal regulatory exposure.

## Escalation path: dedicated database per tenant

Trigger conditions (any one of them flips a tenant to dedicated DB):

1. **Regulatory / contractual requirement** for physical data separation
   (e.g. government agency, defence contractor, critical infrastructure
   under NIS2 or ISO/IEC 27001 certification scope).
2. **Sustained performance isolation** — tenant's telemetry or document
   ingestion volume dominates the shared pool and causes cross-tenant
   latency regressions.
3. **Full export / portability** — tenant wants a verifiable, clean-room
   copy of their data without extraction scripts.
4. **Cross-region residency** — tenant's data must live in a specific
   geographic region the shared cluster does not serve.

## Migration procedure (shared → dedicated)

Zero code change in application layer. Infrastructure-level steps:

1. **Provision** a new Postgres instance/database in the target region.
   Same major version, same Prisma migration head.
2. **Run migrations** (`prisma migrate deploy` pointed at new `DATABASE_URL`).
3. **Apply RLS** (`apply-rls.mjs`) and both roles (`domera_migrator`,
   `domera_app`) — identical contract.
4. **Extract** the tenant's rows using
   `pg_dump --data-only --on-conflict-do-nothing
   --where "tenant_id='<uuid>'"` per table in topological order of FKs.
5. **Import** into new DB.
6. **Route**: add this tenant's id to a routing table read by the connection
   resolver; the resolver picks the per-tenant `DATABASE_URL` instead of the
   shared one.
7. **Verify**: run read-only probes from the app against both the shared and
   the dedicated DB, then flip the routing record.
8. **Purge** the tenant's rows from the shared DB only after two full backup
   cycles elapse without incident.

## Connection resolver contract

The application reads `DATABASE_URL_<TENANT_ID>` if present, otherwise
falls back to the shared `DATABASE_URL`. In Prisma terms, the client is
instantiated per-tenant and cached with a bounded LRU. For MVP only the
shared client is instantiated (zero overhead).

## Guarantees

- No code in `src/modules/**` ever references the shared vs dedicated
  distinction. Only the infra-level resolver does.
- RLS policies are identical in shape across both models.
- Audit trails are emitted the same way; cross-tenant aggregations for
  internal ops run off a CDC stream rather than direct SQL.

## Out of scope for this document

- ETL tooling for ongoing cross-tenant analytics (BI).
- Data-loss-prevention between regions (GDPR Article 46 transfers).
- Customer-managed encryption keys — handled in a separate
  `docs/architecture/key-management.md` when we get there.
