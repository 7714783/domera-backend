# Domera Test Building Seed (SSOT)

## Purpose

Create one idempotent demo workspace and one fully populated demo building (`northstone-demo` / `nt01`) for local development.

## Domain Graph

- `WORKSPACES` contains `ORGANIZATIONS`
- `ORGANIZATIONS` scopes `USERS`
- `WORKSPACES` owns `BUILDINGS`
- `BUILDINGS` contains `ASSETS` (parent-child tree)
- `OBLIGATION_TEMPLATES` applies to `BUILDING_OBLIGATIONS`
- `PPM_TEMPLATES` contains `PPM_PLAN_ITEMS`
- `PPM_PLAN_ITEMS` materializes `TASK_INSTANCES`
- `BUDGETS` contains `BUDGET_LINES`
- `BUDGET_LINES` allocates `INVOICES`
- `APPROVAL_REQUESTS` contains `APPROVAL_STEPS`
- `TASK_INSTANCES` / `APPROVAL_REQUESTS` require `DOCUMENTS`
- `AUDIT_ENTRIES` records all critical transitions

## Seed Flow

1. Guard checks
2. Create/update workspace
3. Create orgs and users
4. Create building
5. Create asset hierarchy
6. Create obligations and PPM template/items
7. Materialize tasks for 90 days
8. Create budgets, invoices, approvals
9. Create documents and audit entries
10. Register BullMQ schedulers
11. Run API and DB smoke checks

## Row-Level Security

- SQL: `apps/api/prisma/rls/001_enable_rls.sql` declares `app_current_tenant_id()`
  and a `<table>_tenant_isolation` policy per tenant-scoped table.
- Apply: `pnpm --filter api db:rls` (runs the SQL via `$executeRawUnsafe`).
- Contract: every service transaction calls
  `select set_config('app.current_tenant_id', <uuid>, true)` before the first
  query; `PrismaService.withTenant(tenantId, fn)` wraps `$transaction` and does
  this for you. Missing context -> NULL -> default-deny on all policies.
- Dev note: FORCE RLS is intentionally off so the seed (run as table owner) can
  write. For production use split roles: migrator/owner without runtime access
  and an app role that RLS applies to. Then turn FORCE back on.

## Security Rules

- Abort when `NODE_ENV=production`
- Abort when `ALLOW_DEMO_SEED != true`
- Abort on non-local `DATABASE_URL` unless `ALLOW_NONLOCAL_DEMO_SEED=true`
- Abort unless `DEMO_DISABLE_EMAIL/SMS/WEBHOOKS=true`
- Use only reserved domains (`example.com`, `*.test`) when `DEMO_ONLY_RESERVED_DOMAINS=true`
- No secrets/tokens in logs or audit metadata

## Scheduler Contract

- `nt01-task-recurrence-materializer` ? `0 5 0 * * *`
- `nt01-overdue-escalator` ? `0 0 * * * *`
- `nt01-document-expiry-check` ? `0 20 1 * * *`
- `nt01-budget-rollup` ? `0 35 0 * * *`

## Local Bootstrap

```bash
docker compose -f infra/docker/docker-compose.yml up -d postgres redis
pnpm install
pnpm --filter api db:push
pnpm --filter api db:rls
ALLOW_DEMO_SEED=true DEMO_DISABLE_EMAIL=true DEMO_DISABLE_SMS=true \
  DEMO_DISABLE_WEBHOOKS=true pnpm --filter api seed:test-building
pnpm --filter api start:worker
pnpm --filter api dev
```

## Verification Endpoints

- `GET /v1/workspaces/:slug`
- `GET /v1/buildings/:slug/overview`
- `GET /v1/buildings/:slug/assets/tree`
- `GET /v1/buildings/:slug/compliance-dashboard`
- `GET /v1/buildings/:slug/budgets`
- `GET /v1/buildings/:slug/approvals`
- `GET /v1/buildings/:slug/documents`
- `GET /v1/buildings/:slug/audit`
- `POST /v1/tasks/:id/complete`
- `POST /v1/approvals/:id/approve`
