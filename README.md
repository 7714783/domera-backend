# Domera Backend (API)

NestJS 11 + Prisma 6 + PostgreSQL 16 + Redis 7 + BullMQ API for the Domera
"Operating System for Buildings" platform.

## Stack

- **NestJS 11** (TypeScript, ES2022)
- **Prisma 6** ORM on **PostgreSQL 16**
- **BullMQ** on **Redis 7** for recurring PPM materialization and escalations
- **bcryptjs + JWT** auth
- **xlsx** importer for regulator PPM catalogs

## Getting started

```bash
# 1. Prereqs: Node 22+, a reachable Postgres and Redis.
# 2. Copy env and fill it in
cp .env.example .env          # then set DATABASE_URL, REDIS_URL, JWT_SECRET

# 3. Install (pnpm or npm both work; lockfile is npm's)
npm install

# 4. Push Prisma schema into the DB and generate client
npx prisma db push
npx prisma generate

# 5. Apply RLS policies (idempotent)
node prisma/rls/apply-rls.mjs

# 6. Seed reference data (roles, permissions, certifications, doc types)
node prisma/seeds/seed-reference.mjs

# 7. Bootstrap the first superadmin (Menivim / Kozaa@326914017 by default)
node prisma/seeds/reset-and-bootstrap.mjs

# 8. (Optional) seed the demo building + PPM programs + staff
node prisma/seeds/seed-first-real-building.mjs
node prisma/seeds/seed-ppm-programs.mjs
node prisma/seeds/seed-staff.mjs

# 9. Run the API
npm run dev                   # http://localhost:4000/v1/health
```

## Key modules

- `auth` — register / login / JWT / me
- `onboarding` — bootstrap workspace + org + first building
- `buildings` — CRUD over portfolio
- `building-core` — floors / units / transport / systems / occupants / contracts
- `ppm` — programs, executions, lifecycle pipeline, wizard (`POST /v1/buildings/:id/ppm/wizard/apply`)
- `iam` — roles, permissions, staff
- `imports` — xlsx regulator catalog importer
- `obligations` — applicability evaluator
- `takeover` — takeover case + gap analysis + signoff

## Domain backbone

```
workspace (tenant) → organizations → buildings → mandates → roles
  → assets → obligations → plans → tasks → documents → approvals → audit
```

No single-building shortcut — every building-scoped row carries `tenantId` + `buildingId`.

## Documentation

- [docs/architecture/buildings-aggregate.md](docs/architecture/buildings-aggregate.md) — multi-building contract
- [docs/architecture/building-core-v1.md](docs/architecture/building-core-v1.md) — Building Core v1 (floors, units, transport, systems)
- [docs/architecture/test-building-seed.md](docs/architecture/test-building-seed.md) — seed and RLS contract

## License

Proprietary — all rights reserved.
