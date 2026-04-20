#!/usr/bin/env node
// Minimal post-deploy smoke: verifies the backend is alive, answers to
// unauthenticated requests correctly, and the frontend responds on the
// configured URL. Exits non-zero on any failure so CI/CD marks the rollout
// as failed.
//
// Usage:
//   API_BASE=https://api.test.example.com \
//   FRONTEND_BASE=https://app.test.example.com \
//     node ops/smoke-check.mjs
//
// Both URLs are required; no hardcoded hosts (keeps prod secrets out of repo).

const API_BASE = process.env.API_BASE;
const FRONTEND_BASE = process.env.FRONTEND_BASE;

if (!API_BASE) { console.error('smoke: API_BASE env var required'); process.exit(2); }
if (!FRONTEND_BASE) { console.error('smoke: FRONTEND_BASE env var required'); process.exit(2); }

let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`\u2713 ${name}`);
  } catch (e) {
    console.error(`\u2717 ${name}: ${(e && e.message) || e}`);
    failed += 1;
  }
}

function expectStatus(res, ...allowed) {
  if (!allowed.includes(res.status)) {
    throw new Error(`expected status ${allowed.join('|')}, got ${res.status}`);
  }
}

// 1. Backend health — must be 200.
await check('backend /v1/health returns 200', async () => {
  const res = await fetch(`${API_BASE}/v1/health`);
  expectStatus(res, 200);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error(`unexpected body: ${JSON.stringify(body)}`);
});

// 2. Tenant-scoped endpoint without token — must reject with 401.
//    If it returns 200, auth is broken; if 500, the app crashed.
await check('backend rejects unauthenticated tenant request with 401', async () => {
  const res = await fetch(`${API_BASE}/v1/auth/me`);
  expectStatus(res, 401);
});

// 3. Metrics endpoint (public Prometheus format) — must be 200 and look
//    like Prometheus text. Mounted under the /v1 prefix like the rest of the API.
await check('backend /v1/metrics is up and Prometheus-shaped', async () => {
  const res = await fetch(`${API_BASE}/v1/metrics`);
  expectStatus(res, 200);
  const text = await res.text();
  if (!/^# HELP|^# TYPE/m.test(text)) {
    throw new Error('metrics body does not look like Prometheus exposition');
  }
});

// 4. Frontend English landing. The App Router uses locale-prefixed routes
//    (middleware doesn't redirect the unprefixed root), so /en is the
//    canonical smoke target.
await check('frontend /en responds 200', async () => {
  const res = await fetch(`${FRONTEND_BASE.replace(/\/$/, '')}/en`);
  expectStatus(res, 200);
});

console.log(`\nsmoke: ${failed === 0 ? 'all checks passed' : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
