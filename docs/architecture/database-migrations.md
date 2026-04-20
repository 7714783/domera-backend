# Database migrations — how schema changes ship

**Status:** P1.2 stabilization complete — `prisma migrate` is the supported path; `prisma db push` is local-sandbox only.

Domera runs on PostgreSQL with multi-tenant RLS, partial unique indexes, and a handful of raw-SQL concerns Prisma's DSL can't express. Three layers cooperate to evolve the schema:

| Layer | What it changes | How it's applied |
|---|---|---|
| **Prisma migrations** (`prisma/migrations/`) | Tables, columns, FK, index/uniques expressible in Prisma DSL | `prisma migrate deploy` |
| **Raw SQL migrations** (`prisma/migrations-sql/`) | Partial indexes, triggers, views, anything with `WHERE` / `USING` | `node prisma/migrations-sql/apply-migrations.mjs` |
| **RLS policies** (`prisma/rls/`) | `ROW LEVEL SECURITY`, policies, `FORCE ROW LEVEL SECURITY`, public RPCs | `node prisma/rls/apply-rls.mjs` |

The deploy hook runs them in that order (see `db:deploy` in `apps/api/package.json`).

---

## Local dev workflow

### First-time setup on a fresh PostgreSQL

```bash
# 1. Split DB roles + RLS (idempotent — safe to re-run)
pnpm --filter @domera/api db:rls

# 2. Apply all Prisma migrations
pnpm --filter @domera/api db:migrate:deploy

# 3. Apply raw-SQL migrations (partial indexes, etc.)
pnpm --filter @domera/api db:migrate:sql

# 4. Generate Prisma client
pnpm --filter @domera/api db:generate

# 5. Seed test building (optional)
pnpm --filter @domera/api seed
```

### Changing the schema

```bash
# 1. Edit apps/api/prisma/schema.prisma

# 2. Create a new migration from the diff + apply it to your local DB
pnpm --filter @domera/api db:migrate:dev --name add_building_meta_field

# 3. Commit the generated files:
#      apps/api/prisma/migrations/<timestamp>_add_building_meta_field/migration.sql
```

`migrate:dev` uses `DATABASE_URL` (or `DATABASE_URL_MIGRATOR` if set) and will:
- create the SQL migration file,
- apply it to your local DB,
- regenerate the Prisma client.

### Changing something Prisma can't express (partial unique, trigger, etc.)

Create a new file under `prisma/migrations-sql/`, following the naming pattern `NNN_short_name.sql`. The runner:
- applies files in lexical order,
- tracks applied files in a `_sql_migrations` table (idempotent on re-run),
- runs each file in a single transaction.

```bash
pnpm --filter @domera/api db:migrate:sql
```

Alternatively, put raw SQL directly inside a Prisma migration's `migration.sql` if it logically belongs together (Prisma will run it unchanged).

### Changing RLS policies

Edit or add a file under `prisma/rls/`, then:

```bash
pnpm --filter @domera/api db:rls
```

The RLS runner uses `DATABASE_URL_SUPER` if set (needs superuser for some ALTER TABLE … FORCE statements), otherwise falls back to `DATABASE_URL_MIGRATOR`.

### When you just need to hack a local sandbox

`prisma db push` is still available as `db:push:sandbox`. Use it ONLY for your own scratch DB — it doesn't produce a migration file, so anything you do won't ship. When you're happy, delete the sandbox DB, then use `db:migrate:dev` from a clean state to produce the real migration.

---

## Test / prod workflow

```bash
# One command for every environment that should converge its schema.
pnpm --filter @domera/api db:deploy
#   = db:migrate:deploy + db:migrate:sql + db:rls
```

**Rules:**
- Never run `db:migrate:dev` / `db:migrate:reset` / `db:push:sandbox` against shared or production DBs.
- Never edit an applied migration in `prisma/migrations/`. Add a new one.
- If you need to roll back, author a new migration that reverses the change and deploy it — migrations are append-only.

---

## One-time baseline (when moving an existing DB onto `prisma migrate`)

The project ran on `prisma db push` until this stabilization. For each environment whose schema already matches `schema.prisma` but has no migration history:

```bash
# 1. On a clean scratch DB (empty), let Prisma author the first migration.
pnpm --filter @domera/api exec prisma migrate dev --name baseline_init --create-only
#    → creates apps/api/prisma/migrations/<ts>_baseline_init/migration.sql

# 2. Commit that migration.

# 3. For each EXISTING environment that already has the schema from db push,
#    mark the baseline as applied WITHOUT re-running it:
DATABASE_URL="..." pnpm --filter @domera/api exec prisma migrate resolve \
    --applied <ts>_baseline_init

# 4. From this point forward, `db:migrate:deploy` will only apply future
#    migrations; the baseline is accounted for.
```

If the schemas diverge (a previous `db push` added or dropped something that isn't in `schema.prisma`), fix the drift BEFORE marking resolved. Use `prisma migrate diff --from-url ... --to-schema-datamodel ...` to see the delta.

---

## CI

The `prisma-validate` job in `.github/workflows/ci.yml` already runs `prisma validate` and the RLS sanity check on every PR. See P1.3 for a follow-up that will spin up a Postgres service, run `db:migrate:deploy` + `db:migrate:sql` on an empty DB, and exit non-zero on any mismatch.

---

## Rules of engagement

| ❌ Don't | ✅ Do |
|---|---|
| `prisma db push` on shared/test/prod | `prisma migrate deploy` |
| Edit a merged migration file | Create a new migration that fixes/reverses it |
| Bypass the runner by running raw SQL in a shell | Put it in `prisma/migrations-sql/NNN_*.sql` |
| Ship schema changes without running `db:migrate:status` locally | Verify your local state matches the committed migrations |
| Use `migrate reset` on anything other than your personal DB | Only on local; re-seed afterwards |

---

## Remaining tech debt (tracked, not blocking)

- CI does not yet spin up a Postgres service to actually run migrations end-to-end (covered by P1.3).
- `gh/domera-backend` mirror still documents `prisma db push` — will be re-synced when we cut the next backend snapshot.
- A few legacy docs (`docs/architecture/test-building-seed.md`, `docs/architecture/buildings-aggregate.md`) mention `db push`; updated in this pass.
- No automated migration testing on down-paths — migrations are append-only, but a test harness that asserts "apply migrations on empty DB then introspect and assert vs schema.prisma" would catch drift early.
