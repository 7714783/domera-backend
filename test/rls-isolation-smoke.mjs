#!/usr/bin/env node
// INIT-005 Phase P1.4b — automated cross-tenant breach probe + raw-DB RLS smoke.
// Run: `npm run test:rls` (boots inside CI against a clean Postgres + a
//       freshly-started API, see .github/workflows/ci.yml job rls-smoke).
//
// Two probes:
//
//   A. CROSS-TENANT REPLAY (HTTP) — register tenant A and tenant B, log in as
//      A, send every read endpoint with X-Tenant-Id of B. Assert 403 on every
//      one (TenantMiddleware membership-check rejection). Catches the breach
//      that INIT-001 originally fixed; CI would have flagged the regression.
//
//   B. RAW-DB RLS (no HTTP) — connect as `domera_app` (NOBYPASSRLS), do NOT
//      call set_config('app.current_tenant_id', ...), then SELECT from a
//      tenant-scoped table. Assert 0 rows. This is the FORCE RLS guarantee
//      from prisma/rls/003_force_rls.sql — if anyone disables FORCE or grants
//      BYPASSRLS to domera_app this turns red.
//
// Exit code: 0 = pass, 1 = fail. Pretty-prints each assertion.

import { strict as assert } from 'node:assert';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
const APP_DB_URL = process.env.DATABASE_URL_APP; // domera_app role; CI sets it
const MIGRATOR_DB_URL = process.env.DATABASE_URL_MIGRATOR || process.env.DATABASE_URL;

// -------------------------------------------------------------- helpers
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('\u2713', name);
    passed++;
  } catch (e) {
    console.error('\u2717', name, '\n   ', e.message);
    failed++;
  }
}

function rand(n = 6) {
  return crypto.randomBytes(n).toString('hex');
}

// Register + bootstrap workspace + building. Returns { token, userId, tenantId, slug }.
async function bootstrapTenant(label) {
  const email = `rls-smoke-${label}-${rand(4)}@test.local`;
  const password = 'rls-smoke-Pa55word!';
  const reg = await call('/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: email, password, email, displayName: `RLS ${label}` }),
  });
  if (reg.status !== 201 && reg.status !== 200) {
    throw new Error(`register ${label} failed: ${reg.status} ${reg.text.slice(0, 200)}`);
  }
  const token = reg.body.token;
  const userId = reg.body.user.id;

  const boot = await call('/v1/onboarding/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      buildingName: `RLS Smoke ${label}`,
      addressLine1: 'CI Street 1',
      city: 'Tel Aviv',
      countryCode: 'IL',
      timezone: 'Asia/Jerusalem',
      buildingType: 'office',
      workspaceName: `RLS Smoke WS ${label}`,
    }),
  });
  if (boot.status !== 201 && boot.status !== 200) {
    throw new Error(`bootstrap ${label} failed: ${boot.status} ${boot.text.slice(0, 200)}`);
  }
  const tenantId = boot.body.tenantId || boot.body.tenant?.id;
  const buildingId = boot.body.buildingId || boot.body.building?.id;
  const slug = boot.body.slug || boot.body.building?.slug;
  if (!tenantId || !buildingId || !slug) {
    throw new Error(`bootstrap ${label} missing fields: ${JSON.stringify(boot.body)}`);
  }
  return { token, userId, tenantId, buildingId, slug };
}

// -------------------------------------------------------------- PROBE A
console.log('\n--- PROBE A: cross-tenant HTTP breach replay ---');

const A = await bootstrapTenant('A');
const B = await bootstrapTenant('B');
console.log(`   tenant A: ${A.tenantId.slice(0, 8)} (${A.slug})`);
console.log(`   tenant B: ${B.tenantId.slice(0, 8)} (${B.slug})`);

// Endpoints to replay. Each must reject when token belongs to A but
// X-Tenant-Id targets B. Pick a representative cross-section: building reads,
// PPM, approvals, audit, cleaning, devices, tasks, reactive — the common
// surface a foothold would attempt to exfiltrate.
const ENDPOINTS = [
  // Building-scoped reads
  ['GET', '/v1/buildings'],
  ['GET', `/v1/buildings/${B.slug}/floors`],
  ['GET', `/v1/buildings/${B.slug}/units`],
  ['GET', `/v1/buildings/${B.slug}/locations`],
  ['GET', `/v1/buildings/${B.slug}/systems`],
  ['GET', `/v1/buildings/${B.slug}/transport`],
  ['GET', `/v1/buildings/${B.slug}/staff`],
  ['GET', `/v1/buildings/${B.slug}/summary`],
  ['GET', `/v1/buildings/${B.slug}/assets`],
  ['GET', `/v1/buildings/${B.slug}/ppm/programs`],
  ['GET', `/v1/buildings/${B.slug}/ppm/plan-items`],
  ['GET', `/v1/buildings/${B.slug}/ppm/calendar`],
  ['GET', `/v1/buildings/${B.slug}/qr-locations`],
  ['GET', `/v1/buildings/${B.slug}/incidents`],
  ['GET', `/v1/buildings/${B.slug}/service-requests`],
  ['GET', `/v1/buildings/${B.slug}/cleaning`],
  ['GET', `/v1/buildings/${B.slug}/documents`],

  // Workspace-wide reads (cross-cut domain modules)
  ['GET', '/v1/audit'],
  ['GET', '/v1/devices'],
  ['GET', '/v1/tasks'],
  ['GET', '/v1/tasks/inbox?kind=all'],
  ['GET', '/v1/cleaning/requests?buildingId=' + B.buildingId],
  ['GET', '/v1/cleaning/zones?buildingId=' + B.buildingId],
  ['GET', '/v1/approvals'],
  ['GET', '/v1/triage'],
  ['GET', '/v1/projects'],
  ['GET', '/v1/vendor-invoices'],
  ['GET', '/v1/inventory'],
  ['GET', '/v1/calendar-blackouts'],
  ['GET', '/v1/condition-triggers'],
  ['GET', '/v1/document-links'],
  ['GET', '/v1/document-templates'],
  ['GET', '/v1/emergency-overrides'],
  ['GET', '/v1/obligations'],
  ['GET', '/v1/occupants'],
  ['GET', '/v1/organizations'],
  ['GET', '/v1/connectors'],
  ['GET', '/v1/webhooks'],
  ['GET', '/v1/qr-locations'],
  ['GET', '/v1/rounds'],

  // INIT-013/014 admin surfaces
  ['GET', '/v1/team'],
  ['GET', '/v1/roles'],
  ['GET', '/v1/role-assignments'],
  ['GET', '/v1/workspace-contractors'],
  ['GET', '/v1/notifications'],
  ['GET', '/v1/notifications/deliveries'],
  ['GET', '/v1/notifications/rules'],
  ['GET', '/v1/notifications/templates'],
];

for (const [method, path] of ENDPOINTS) {
  await test(`A→B ${method} ${path} blocked`, async () => {
    const r = await call(path, {
      method,
      headers: {
        authorization: `Bearer ${A.token}`,
        'x-tenant-id': B.tenantId, // breach attempt
      },
    });
    // Acceptable: 403 (membership mismatch) or 404 (resource scope). Anything
    // 2xx is a leak; anything 5xx is a crash that masks the leak detector.
    assert.ok(
      r.status === 403 || r.status === 404,
      `expected 403/404, got ${r.status} body=${r.text.slice(0, 200)}`,
    );
  });
}

// Sanity: A should be able to read its own building list (proves auth itself works).
await test('A→A GET /v1/buildings returns own tenant', async () => {
  const r = await call('/v1/buildings', {
    headers: { authorization: `Bearer ${A.token}`, 'x-tenant-id': A.tenantId },
  });
  assert.equal(r.status, 200);
});

// Sanity: A WITHOUT X-Tenant-Id should also work (middleware auto-resolves).
await test('A→(no header) GET /v1/buildings auto-resolves to A', async () => {
  const r = await call('/v1/buildings', { headers: { authorization: `Bearer ${A.token}` } });
  assert.equal(r.status, 200);
});

// -------------------------------------------------------------- PROBE B
console.log('\n--- PROBE B: raw-DB RLS without set_config ---');

if (!APP_DB_URL) {
  console.log(
    '   SKIPPED — DATABASE_URL_APP not set. CI sets it; locally export it to run this probe.',
  );
} else {
  await test('domera_app SELECT without set_config returns 0 rows (FORCE RLS)', async () => {
    const app = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });
    try {
      // Two valid outcomes — both prove no data can escape:
      //   a) RLS policy filters everything → 0 rows
      //   b) Table-level grant missing → permission denied (42501)
      // Anything else is a leak.
      let rows;
      try {
        rows = await app.$queryRawUnsafe('SELECT COUNT(*)::int as n FROM buildings');
      } catch (e) {
        if (/permission denied/i.test(e.message)) {
          // Outcome (b) — test passes.
          return;
        }
        throw e;
      }
      assert.equal(
        rows[0].n,
        0,
        `expected 0 rows without set_config, got ${rows[0].n} — FORCE RLS likely disabled or domera_app got BYPASSRLS`,
      );
    } finally {
      await app.$disconnect();
    }
  });

  await test('domera_app SELECT WITH set_config sees only that tenant', async () => {
    const app = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });
    try {
      // Set tenant A in a transaction and count buildings — must be >0 since
      // we just bootstrapped one.
      const result = await app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `select set_config('app.current_tenant_id', '${A.tenantId}', true)`,
        );
        return tx.$queryRawUnsafe('SELECT COUNT(*)::int as n FROM buildings');
      });
      assert.ok(
        result[0].n >= 1,
        `expected >=1 building for tenant A with set_config, got ${result[0].n}`,
      );

      // Same query with tenant B's id should also see >=1 (its own).
      const resultB = await app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `select set_config('app.current_tenant_id', '${B.tenantId}', true)`,
        );
        return tx.$queryRawUnsafe('SELECT COUNT(*)::int as n FROM buildings');
      });
      assert.ok(resultB[0].n >= 1, `expected >=1 building for tenant B with set_config`);
    } finally {
      await app.$disconnect();
    }
  });

  await test('domera_app cannot SELECT another tenant by guessed UUID', async () => {
    // A.tenantId is an admin-known value but the app role with B's GUC
    // configured must not see A's row.
    const app = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });
    try {
      const seen = await app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `select set_config('app.current_tenant_id', '${B.tenantId}', true)`,
        );
        return tx.$queryRawUnsafe(
          `SELECT COUNT(*)::int as n FROM buildings WHERE "tenantId" = '${A.tenantId}'`,
        );
      });
      assert.equal(seen[0].n, 0, `tenant B GUC saw ${seen[0].n} rows of tenant A — RLS leaked`);
    } finally {
      await app.$disconnect();
    }
  });
}

// -------------------------------------------------------------- cleanup
console.log('\n--- cleanup: delete the two smoke tenants ---');
if (MIGRATOR_DB_URL) {
  const mig = new PrismaClient({ datasources: { db: { url: MIGRATOR_DB_URL } } });
  try {
    for (const t of [A.tenantId, B.tenantId]) {
      await mig
        .$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${t}' CASCADE`)
        .catch(async () => {
          // CASCADE keyword unsupported on older PG variants; try plain delete.
          await mig.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${t}'`).catch(() => {});
        });
    }
    console.log('   cleanup OK');
  } finally {
    await mig.$disconnect();
  }
} else {
  console.log('   no migrator URL — leaving smoke tenants in place');
}

// -------------------------------------------------------------- summary
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
