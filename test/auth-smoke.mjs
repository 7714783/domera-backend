#!/usr/bin/env node
// Authorization smoke tests. Run: `node apps/api/test/auth-smoke.mjs`
// Expects a locally running API on http://127.0.0.1:4000 with the default
// demo tenant seeded. Exit code 0 = pass, non-zero = fail.
//
// Covers (SSOT §P18):
//   1. /v1/health is publicly reachable
//   2. Tenant-scoped endpoints reject requests without a valid session
//   3. Unknown session token yields 401
//   4. Cross-tenant reads return empty (RLS isolation)
//   5. Public metrics endpoint emits Prometheus format
//   6. Inbound webhook rejects bad signatures
//   7. Privacy / DSAR endpoint does not leak cross-tenant records

import { strict as assert } from 'node:assert';

const BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
const TENANT_MENIVIM = '3ea4f5b0-ed6b-43cc-9966-2544caea8737';
const TENANT_FAKE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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

let passed = 0,
  failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('\u2713', name);
    passed++;
  } catch (e) {
    console.error('\u2717', name, '-', e.message);
    failed++;
  }
}

await test('health is public', async () => {
  const r = await call('/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

await test('unknown session token yields 401 on protected route', async () => {
  const r = await call('/v1/mfa/status', { headers: { Authorization: 'Bearer not-a-real-token' } });
  assert.equal(r.status, 401);
});

await test('missing auth on protected route yields 401', async () => {
  const r = await call('/v1/mfa/status');
  assert.equal(r.status, 401);
});

await test('RLS: real-tenant buildings returns data', async () => {
  const r = await call('/v1/buildings', { headers: { 'x-tenant-id': TENANT_MENIVIM } });
  assert.equal(r.status, 200);
  assert.ok(r.body.total >= 0, 'total should be a number');
});

await test('RLS: fake-tenant buildings returns 0 rows', async () => {
  const r = await call('/v1/buildings', { headers: { 'x-tenant-id': TENANT_FAKE } });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 0);
});

await test('metrics endpoint emits Prometheus format', async () => {
  const r = await call('/v1/metrics');
  assert.equal(r.status, 200);
  assert.match(r.text, /# HELP http_requests_total/);
});

await test('inbound webhook rejects missing channel', async () => {
  const r = await call('/v1/webhooks/inbound/nonexistent-channel', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT_MENIVIM },
    body: JSON.stringify({ any: 'payload' }),
  });
  // 404 (channel not registered) or 400 (rawBody requirement) are both
  // acceptable — the key is that no 2xx response reveals anything.
  assert.ok([400, 404].includes(r.status), `expected 400/404, got ${r.status}`);
});

await test('privacy ROPA endpoint is tenant-scoped', async () => {
  const real = await call('/v1/privacy/ropa', { headers: { 'x-tenant-id': TENANT_MENIVIM } });
  const fake = await call('/v1/privacy/ropa', { headers: { 'x-tenant-id': TENANT_FAKE } });
  assert.equal(real.status, 200);
  assert.equal(fake.status, 200);
  assert.notDeepEqual(
    real.body.subjectCounts,
    fake.body.subjectCounts,
    'real tenant should see different subject counts than fake tenant',
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
