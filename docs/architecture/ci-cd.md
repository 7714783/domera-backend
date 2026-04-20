# CI/CD — pipeline contract

**Status:** P1.3 minimal pipeline. Covers PR validation + test-env rollout. Prod rollout is explicitly out of scope until the test path stabilises.

---

## The two pipelines

### 1. PR validation — `.github/workflows/ci.yml`

Runs on every push and PR against `main`. Also reusable from other workflows via `workflow_call`.

| Job | Purpose |
|---|---|
| `install` | Single pnpm install, caches the store for downstream jobs |
| `typecheck` | `tsc --noEmit` for api / frontend / mobile (matrix) |
| `lint` | per-app `lint` script |
| `build` | `next build` / `nest build` matrix for api + frontend |
| `prisma-validate` | `prisma validate` + RLS SQL sanity + forbidden-`db push` guard + raw-SQL filename convention |
| `migrations-apply` | Spins up **Postgres 16**, runs `db:rls` → `db:migrate:deploy` → `db:migrate:sql` → asserts `prisma migrate status` is clean. Catches broken migrations before merge. |

Fail-fast: any red job blocks merge (branch protection rule).

### 2. Test rollout — `.github/workflows/deploy-test.yml`

Runs on push to `main` or `test`, and on manual `workflow_dispatch`. Four sequential jobs — each one needs the previous to succeed.

```
validate (reuses ci.yml)
    ↓
migrate → runs prisma migrate deploy + raw-SQL migrations against TEST_DATABASE_URL,
          asserts migrate status is clean
    ↓
deploy   → POSTs to TEST_BACKEND_DEPLOY_HOOK and TEST_FRONTEND_DEPLOY_HOOK
           (webhook-based so the repo stays host-agnostic: works with Railway,
            Vercel deploy hooks, Render, Fly.io, etc.)
    ↓
smoke    → waits ~60s for providers to settle, runs ops/smoke-check.mjs against
           TEST_API_BASE + TEST_FRONTEND_BASE
```

Concurrency: `deploy-test-${{ github.ref }}` with `cancel-in-progress: false` — deploys queue behind each other, they never overlap.

---

## Required GitHub secrets / env

All live under **Settings → Environments → `test`** (not repo-level, so prod secrets can be scoped separately later).

| Secret | Where it's used | Example |
|---|---|---|
| `TEST_DATABASE_URL` | `migrate` job — needs BYPASSRLS (migrator user) to run migrations and raw SQL | `postgresql://domera_migrator:***@…/domera_test` |
| `TEST_BACKEND_DEPLOY_HOOK` | `deploy` job — URL that triggers backend redeploy on your hosting provider | Railway deploy hook / Render deploy hook |
| `TEST_FRONTEND_DEPLOY_HOOK` | `deploy` job — same idea for the frontend | Vercel deploy hook |
| `TEST_API_BASE` | `smoke` job — base URL to probe | `https://api.test.example.com` |
| `TEST_FRONTEND_BASE` | `smoke` job — base URL to probe | `https://app.test.example.com` |

If any secret is missing, the step fails explicitly (`exit 1` with a descriptive message) rather than crashing with a generic error.

No secrets are required for `ci.yml` / PR validation. The `migrations-apply` job uses a throwaway in-CI Postgres service.

---

## Smoke check (`ops/smoke-check.mjs`)

Five probes, all must pass:

1. `GET /v1/health` → 200, body `{ status: "ok" }`.
2. `GET /v1/auth/me` without token → **401** (auth wiring alive; 200 here means broken).
3. `GET /metrics` → 200 and body matches Prometheus exposition format.
4. `GET /` on frontend → 200 or 3xx redirect.
5. `GET /en` on frontend → 200 (App Router locale route resolves).

Runs with just `API_BASE` + `FRONTEND_BASE` env — no tenant ids, no credentials, nothing to leak.

---

## How schema changes propagate

```
[dev laptop]                                  [CI PR]                              [TEST env]
edit schema.prisma            →      migrations-apply runs            →   deploy-test
db:migrate:dev --name X               on empty Postgres:                    migrate job:
commit the migration                  deploy → sql → rls                     migrate deploy
                                      must be green                          db:migrate:sql
                                                                             status must be clean
                                                                             then kick redeploy
                                                                             then smoke
```

No `prisma db push` anywhere in this path — the CI guard in `prisma-validate` fails if anyone reintroduces it.

---

## Fail-fast behaviour

| Failure point | What happens |
|---|---|
| Lint / typecheck / build on PR | Merge blocked |
| `migrations-apply` on PR | Merge blocked |
| `validate` in deploy-test | `migrate`, `deploy`, `smoke` skipped |
| `migrate` in deploy-test | `deploy`, `smoke` skipped — TEST env stays on the previous version |
| `deploy` hook webhook returns non-2xx | `smoke` skipped, workflow fails |
| `smoke` any check fails | Workflow fails loud; rollout is marked broken even if the providers deployed successfully |

The migrate → deploy → smoke ordering is deliberate: the DB is always upgraded **before** the code that expects the new schema.

---

## What's intentionally NOT in scope

- **Production deploy workflow** — will be added as `deploy-prod.yml` once the test path runs clean for a couple of weeks. Prod will require an extra `approval` environment gate.
- **Blue/green or canary** — single-slot test/prod for now; an extra `wait-and-verify` step is the first upgrade.
- **Full e2e coverage** — smoke is five probes, not a product test suite. Heavy e2e will land as a separate workflow that can run on a schedule.
- **Rollback automation** — if deploy fails and migrations succeeded, the next code-deploy will ship from the previous commit's state once the bug is fixed and re-merged. Active rollback of migrations needs manual action (Prisma migrations are append-only; revert = author an inverse migration).
- **Secret rotation automation**.
- **Dependency update automation** (dependabot/renovate).

---

## Baseline migration note

The first migration in `apps/api/prisma/migrations/` is `20260420000000_baseline_init` — snapshot of the schema as it stood at the end of the `prisma db push` era. On existing environments this is marked as already-applied via:

```bash
DATABASE_URL="..." pnpm --filter @domera/api exec prisma migrate resolve \
  --applied 20260420000000_baseline_init
```

Do this **once per env** when you flip an env onto the migrate path. The CI job `migrations-apply` doesn't need this — it runs against an empty Postgres and applies baseline as just another migration file.

All future schema changes → new migration under the same folder, committed alongside the PR.
