#!/usr/bin/env node
// GROWTH-001 Gate 2 — auth-revoke smoke.
//
// Single property: a JWT minted by /v1/auth/login MUST be rejected with
// HTTP 401 the moment its session is revoked via /v1/auth/logout. If
// this gate ever fails, every other access-control guarantee is moot —
// stale tokens would survive password resets, role revokes, and tenant
// kill-switches. This is a hard launch gate (GROWTH-001 NS-18).
//
// Steps:
//   1. POST /v1/auth/login with seeded demo creds → receive token T.
//   2. GET  /v1/auth/me with T → expect 200.
//   3. POST /v1/auth/logout with T → expect 200.
//   4. GET  /v1/auth/me with the SAME T → expect 401.
//
// Exit 0 = pass. Exit non-zero = the gate fails — launch-gates
// aggregator flips status to "blocked" and resets the 48h timer.
//
// Env:
//   API_BASE                — defaults to http://127.0.0.1:4000
//   AUTH_SMOKE_EMAIL        — defaults to seeded staff email
//   AUTH_SMOKE_PASSWORD     — defaults to seed-staff DEFAULT_PASSWORD
//                             ('demo-password').

import { strict as assert } from 'node:assert';

const BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
const EMAIL = process.env.AUTH_SMOKE_EMAIL || 'owner@menivim.demo';
const PASSWORD = process.env.AUTH_SMOKE_PASSWORD || 'demo-password';

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
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
async function step(name, fn) {
  try {
    await fn();
    console.log('✓', name);
    passed++;
  } catch (e) {
    console.error('✗', name, '-', e.message);
    failed++;
  }
}

let token = null;

await step('POST /v1/auth/login returns a session token', async () => {
  const r = await call('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(r.status, 200, `login failed: ${r.status} ${r.text.slice(0, 200)}`);
  assert.ok(r.body && typeof r.body.token === 'string', 'response.token must be a string');
  token = r.body.token;
});

await step('GET /v1/auth/me with fresh token returns 200', async () => {
  if (!token) throw new Error('no token from previous step — cannot continue');
  const r = await call('/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200, `expected 200 with fresh token, got ${r.status}`);
});

await step('POST /v1/auth/logout revokes the session', async () => {
  if (!token) throw new Error('no token — cannot logout');
  const r = await call('/v1/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(r.status, 200, `logout failed: ${r.status} ${r.text.slice(0, 200)}`);
});

await step('GET /v1/auth/me with revoked token returns 401', async () => {
  if (!token) throw new Error('no token — cannot probe revocation');
  const r = await call('/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(
    r.status,
    401,
    `revoked JWT must be rejected — got ${r.status}. Body: ${r.text.slice(0, 200)}`,
  );
});

await step('protected route also rejects revoked token', async () => {
  if (!token) throw new Error('no token');
  const r = await call('/v1/mfa/status', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 401, `protected route must reject revoked token, got ${r.status}`);
});

console.log(`\nauth-revoke gate: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
