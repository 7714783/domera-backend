// Integration test for RLS cross-tenant isolation.
//
// Guarantees that once `SET app.tenant_id = '<tenantA>'` is active on a
// connection authenticated as the `domera_app` role (NOBYPASSRLS), any
// query MUST NOT see rows belonging to a different tenant. This locks in
// the promise of migration 004_rls_all_tenant_tables.sql against future
// regressions (a missing FORCE, a dropped policy, or an accidental
// BYPASSRLS grant would fail this test).
//
// Run: `pnpm --filter @domera/api test:rls`
// Requires env vars:
//   DATABASE_URL_SUPER   — superuser for setup/teardown
//   DATABASE_URL         — domera_app role (the runtime client)
// Both are provisioned by apps/api/prisma/rls/apply-rls.mjs.
//
// The test SKIPS gracefully when DATABASE_URL_SUPER is absent (local dev
// without the split-roles setup).

import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

// Load .env if run outside the nest process.
try {
  const dotenv = await import('dotenv');
  dotenv.config();
  dotenv.config({ path: new URL('../../../.env', import.meta.url).pathname.replace(/^\//, '') });
} catch {
  /* optional */
}

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL;

// Same credentials for super + app means we're talking to a single-superuser
// setup (Railway-managed Postgres, shared-hosting Postgres, etc.) where the
// superuser implicitly has BYPASSRLS and policies don't apply. Skip — the
// test is only meaningful against the split-roles provisioning from
// 002_split_roles.sql.
const singleRole = superUrl && appUrl && superUrl === appUrl;

test(
  'RLS — SET app.tenant_id filters cross-tenant reads',
  { skip: !superUrl || !appUrl || singleRole },
  async () => {
    const superDb = new PrismaClient({ datasources: { db: { url: superUrl } } });
    const appDb = new PrismaClient({ datasources: { db: { url: appUrl } } });

    const tenantA = 'test-rls-tenant-a-' + Date.now();
    const tenantB = 'test-rls-tenant-b-' + Date.now();

    try {
      // Seed: two tenants, two buildings — one per tenant.
      await superDb.$executeRaw`
      INSERT INTO tenants (id, name, slug, "createdAt", "updatedAt")
      VALUES (${tenantA}, 'RLS Test A', ${tenantA}, now(), now()),
             (${tenantB}, 'RLS Test B', ${tenantB}, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
      // Buildings has several NOT NULL columns (timezone / countryCode /
      // city / addressLine1). Supply synthetic values — nothing else touches
      // them since we delete the row on teardown.
      await superDb.$executeRaw`
      INSERT INTO buildings (
        id, "tenantId", slug, name, timezone, "countryCode", city, "addressLine1",
        "createdAt", "updatedAt", status
      ) VALUES
      (${`b-${tenantA}`}, ${tenantA}, ${`b-${tenantA}`}, 'Building A',
       'UTC', 'XX', 'Testville', '1 Test Rd', now(), now(), 'active'),
      (${`b-${tenantB}`}, ${tenantB}, ${`b-${tenantB}`}, 'Building B',
       'UTC', 'XX', 'Testville', '2 Test Rd', now(), now(), 'active')
      ON CONFLICT (id) DO NOTHING
    `;

      // Act as tenant A: transaction + SET app.tenant_id + read buildings.
      const seenAsA = await appDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA}'`);
        return tx.$queryRaw`SELECT id, "tenantId" FROM buildings WHERE id IN (${`b-${tenantA}`}, ${`b-${tenantB}`})`;
      });
      // Must see only tenantA's row. If both appear, RLS is broken.
      const asArows = seenAsA;
      assert.equal(asArows.length, 1, 'tenant A must see exactly 1 row');
      assert.equal(asArows[0].tenantId, tenantA, 'seen tenantId must match context');

      // Act as tenant B: same SQL, different context.
      const seenAsB = await appDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantB}'`);
        return tx.$queryRaw`SELECT id, "tenantId" FROM buildings WHERE id IN (${`b-${tenantA}`}, ${`b-${tenantB}`})`;
      });
      assert.equal(seenAsB.length, 1, 'tenant B must see exactly 1 row');
      assert.equal(seenAsB[0].tenantId, tenantB, 'seen tenantId must match context');

      // Without a tenant context set, the NOBYPASSRLS role must see 0 rows.
      const seenAsNone = await appDb.$queryRaw`
      SELECT id FROM buildings WHERE id IN (${`b-${tenantA}`}, ${`b-${tenantB}`})
    `;
      assert.equal(seenAsNone.length, 0, 'no-context query must return 0 rows');
    } finally {
      // Cleanup via superuser (FORCE RLS blocks the app role from deleting).
      await superDb.$executeRaw`DELETE FROM buildings WHERE "tenantId" IN (${tenantA}, ${tenantB})`;
      await superDb.$executeRaw`DELETE FROM tenants WHERE id IN (${tenantA}, ${tenantB})`;
      await superDb.$disconnect();
      await appDb.$disconnect();
    }
  },
);
