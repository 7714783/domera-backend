#!/usr/bin/env node
// Contract test: GET /v1/buildings/:id/locations
//
// INIT-005 reported a P0 bug where this endpoint returned HTTP 500 against
// fresh tenants. The bug stopped reproducing in PROD on 2026-04-26 (likely
// fixed by migration 011 RLS GUC rename). This test pins the contract so
// the regression cannot come back silently.
//
// Asserts:
//   1. Empty building → HTTP 200 with []
//   2. Building with a floor + a location → HTTP 200 with the location
//      projected into the canonical shape (id/code/name/floorId/floorNumber/
//      isLeasable/source='location').
//   3. Cross-tenant isolation: a second tenant's call to the first tenant's
//      building slug returns 404 / 403 (NOT 500, NOT cross-tenant data).
//   4. Refresh: a second GET after the first returns the same data — proves
//      the row is persisted, not in-memory state.
//
// Skipped unless API_BASE is reachable. Pollutes PROD with tenant rows
// when run there; prefer a local API for routine runs. Set API_BASE to
// override (default: http://127.0.0.1:4000).
//
// Exit 0 = pass, non-zero = fail.

import { strict as assert } from 'node:assert';

const BASE = process.env.API_BASE || 'http://127.0.0.1:4000';

async function call(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, body, text };
}

async function probeAlive() {
  try {
    const r = await fetch(BASE + '/v1/health');
    return r.ok;
  } catch {
    return false;
  }
}

async function bootstrapTenant(label) {
  const username = `loc-contract-${label}-${Date.now()}@example.com`;
  const password = 'TestPass-' + Math.random().toString(36).slice(2, 12);

  const reg = await call('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email: username }),
  });
  assert.equal(reg.status, 201, `register ${label}: ${reg.text}`);
  const token = reg.body.token;
  assert.ok(token, 'register returned no token');

  const boot = await call('/v1/onboarding/bootstrap', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      workspaceName: `Loc-Contract-${label}-${Date.now()}`,
      buildingName: `Loc Contract Tower ${label}`,
      addressLine1: '1 Contract St',
      city: 'Tel Aviv',
      countryCode: 'IL',
      timezone: 'Asia/Jerusalem',
    }),
  });
  assert.equal(boot.status, 201, `bootstrap ${label}: ${boot.text}`);
  const slug = boot.body.building.slug;
  const tenantId = boot.body.tenant?.id || boot.body.building?.tenantId;
  assert.ok(slug, 'bootstrap missing slug');
  assert.ok(tenantId, 'bootstrap missing tenantId');
  return { token, slug, tenantId };
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('✓ ' + name);
    passed++;
  } catch (e) {
    console.error('✗ ' + name + '\n   ' + (e?.message || e));
    failed++;
  }
}

if (!(await probeAlive())) {
  console.log(`API unreachable at ${BASE}; skipping locations contract test.`);
  process.exit(0);
}

const A = await bootstrapTenant('A');
const headersA = { Authorization: `Bearer ${A.token}`, 'X-Tenant-Id': A.tenantId };

await test('empty building returns 200 with []', async () => {
  const r = await call(`/v1/buildings/${A.slug}/locations`, { headers: headersA });
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text}`);
  assert.ok(Array.isArray(r.body), 'body must be array');
  assert.equal(r.body.length, 0, 'fresh building should have no locations');
});

let createdLocationId;
let floorId;
await test('create floor + location, GET returns the location', async () => {
  const flr = await call(`/v1/buildings/${A.slug}/floors`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({ floorCode: 'L01', floorNumber: 1, floorType: 'office' }),
  });
  assert.equal(flr.status, 201, `floor create: ${flr.text}`);
  floorId = flr.body.id;

  const loc = await call(`/v1/buildings/${A.slug}/locations`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify({
      floorId,
      code: 'LOBBY-01',
      name: 'Main Lobby',
      locationType: 'lobby',
    }),
  });
  assert.equal(loc.status, 201, `location create: ${loc.text}`);
  createdLocationId = loc.body.id;

  const r = await call(`/v1/buildings/${A.slug}/locations`, { headers: headersA });
  assert.equal(r.status, 200, `list after create: ${r.text}`);
  assert.ok(Array.isArray(r.body));
  const found = r.body.find((x) => x.id === createdLocationId);
  assert.ok(found, 'newly created location must appear in list');
  assert.equal(found.source, 'location');
  assert.equal(found.code, 'LOBBY-01');
  assert.equal(found.name, 'Main Lobby');
  assert.equal(found.floorId, floorId);
  assert.equal(found.floorNumber, 1);
  assert.equal(found.isLeasable, false);
});

await test('refresh: second GET returns same data (row persisted)', async () => {
  const r = await call(`/v1/buildings/${A.slug}/locations`, { headers: headersA });
  assert.equal(r.status, 200);
  assert.ok(
    r.body.find((x) => x.id === createdLocationId),
    'location still present',
  );
});

await test('cross-tenant authenticated → strict 404 (B token + B tenantId hits A slug)', async () => {
  const B = await bootstrapTenant('B');
  const headersB = { Authorization: `Bearer ${B.token}`, 'X-Tenant-Id': B.tenantId };
  const r = await call(`/v1/buildings/${A.slug}/locations`, { headers: headersB });
  // Tightened 2026-04-26: explicit 404 (slug not found in B's tenant) is the
  // expected behaviour. 200 [] used to be tolerated but allowed silent
  // tenant-scope drift; if the resolver ever stopped applying tenantId
  // filtering, the test would still pass with []. Now any non-404 (incl. 200
  // with body) is a regression.
  assert.equal(r.status, 404, `expected strict 404, got HTTP ${r.status}: ${r.text}`);
});

await test('cross-tenant with forged X-Tenant-Id header → strict 403', async () => {
  // B's token + A's tenantId header. Middleware must reject before the
  // controller ever runs because B has no membership in A's tenant.
  const B = await bootstrapTenant('B-forge');
  const r = await call(`/v1/buildings/${A.slug}/locations`, {
    headers: { Authorization: `Bearer ${B.token}`, 'X-Tenant-Id': A.tenantId },
  });
  assert.equal(r.status, 403, `expected 403 on forged tenant header, got ${r.status}: ${r.text}`);
});

await test('no-auth + valid X-Tenant-Id → strict 401 (catches auth bypass)', async () => {
  // CRITICAL regression: prior to the 2026-04-26 middleware fix this returned
  // 200 with real tenant data — anyone with a guessed tenant UUID could read
  // every listing endpoint without authenticating. The fix in
  // src/common/tenant.middleware.ts now demands a valid session for all
  // non-bypass paths. This test pins it.
  const r = await call(`/v1/buildings/${A.slug}/locations`, {
    headers: { 'X-Tenant-Id': A.tenantId },
  });
  assert.equal(r.status, 401, `expected 401, got ${r.status}: ${r.text}`);
});

console.log(`\nlocations.contract: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
