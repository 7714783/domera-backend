// Tenant middleware session-revocation regression guard.
//
// Hardening 2026-04-30 — the middleware used to validate the JWT
// signature alone (jwt.verify), which left a window where a logged-out
// or admin-revoked session continued to access tenant-scoped routes
// until the JWT naturally expired. The fix queries the Session row in
// Postgres and rejects when revokedAt is set, expiresAt is in the
// past, or no row exists.
//
// This test pins the contract at the source level (no DB needed):
//   1. The middleware imports `createHash` and computes a sha256 of the
//      bearer to look up the Session row by tokenHash.
//   2. The middleware queries `prisma.session.findUnique({tokenHash})`.
//   3. The middleware rejects when revokedAt is non-null OR expiresAt
//      is past OR userId mismatches the JWT sub.
//   4. The middleware throws UnauthorizedException with
//      "session revoked or expired" on failure.
//
// A future refactor that drops any of these properties will fail the
// test and require an architectural-review override.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const middlewarePath = join(here, '..', 'src', 'common', 'tenant.middleware.ts');
const src = readFileSync(middlewarePath, 'utf8');

test('middleware imports createHash for tokenHash computation', () => {
  assert.match(
    src,
    /import\s*\{\s*createHash\s*\}\s*from\s*['"]node:crypto['"]/,
    'tenant.middleware.ts must import createHash from node:crypto for the session-hash lookup',
  );
});

test('middleware computes sha256(token) before the session lookup', () => {
  // Either an inline createHash('sha256') call OR a sha256() helper
  // that wraps it. Both shapes are acceptable — we just assert SOMETHING
  // computes the digest in this file, and that the digest feeds the DB
  // query (a separate assertion).
  const inlined = /createHash\(\s*['"]sha256['"]\s*\)/.test(src);
  assert.ok(inlined, 'middleware must compute createHash("sha256") on the token');
});

test('middleware looks up the Session row by tokenHash', () => {
  // session.findUnique with a tokenHash where-clause. Either the call
  // site uses { tokenHash } shorthand or { tokenHash: <var> }; both
  // satisfy.
  const re = /prisma\.session\.findUnique\s*\(\s*\{\s*where\s*:\s*\{\s*tokenHash\s*[:}]/;
  assert.match(
    src,
    re,
    'middleware must call prisma.session.findUnique({where:{tokenHash}}) — JWT signature is insufficient',
  );
});

test('middleware rejects when revokedAt is non-null', () => {
  // The validity expression must include `revokedAt === null` (or
  // equivalent !revokedAt-style). Pin on the explicit form to keep the
  // contract self-evident for code review.
  assert.match(
    src,
    /revokedAt\s*===\s*null/,
    'session-validity check must require revokedAt === null',
  );
});

test('middleware rejects when expiresAt is in the past', () => {
  assert.match(
    src,
    /expiresAt\.getTime\(\)\s*>=\s*Date\.now\(\)/,
    'session-validity check must require expiresAt >= now',
  );
});

test('middleware rejects when session userId does not match JWT sub', () => {
  assert.match(
    src,
    /row\.userId\s*===\s*payload\.sub/,
    'session-validity check must require row.userId === payload.sub (defends against JWT/session split-brain)',
  );
});

test('middleware throws UnauthorizedException on failed session check', () => {
  assert.match(
    src,
    /throw\s+new\s+UnauthorizedException\(\s*['"`]session revoked or expired['"`]/,
    'middleware must throw UnauthorizedException("session revoked or expired") when the live session check fails',
  );
});

test('middleware caches session-check result with a bounded TTL', () => {
  // Cache layer is required so the per-request DB hit doesn't dominate
  // hot paths. The TTL must be ≤ 5 minutes — past that, a revoked
  // session takes too long to take effect.
  const ttlMatch = src.match(/SESSION_CACHE_TTL_MS\s*=\s*(\d+(?:_\d+)*)/);
  assert.ok(ttlMatch, 'SESSION_CACHE_TTL_MS constant required');
  const ttl = Number(ttlMatch[1].replaceAll('_', ''));
  assert.ok(
    ttl > 0 && ttl <= 5 * 60_000,
    `SESSION_CACHE_TTL_MS=${ttl}ms outside (0, 300000] — session revocation propagation would be unacceptable`,
  );
});

test('middleware bypass list still excludes tenant-scoped routes', () => {
  // Spot-check: BYPASS_PATHS must not include something that should be
  // session-gated. A future PR that adds /v1/buildings or /v1/tasks here
  // would silently re-open the original leak.
  const bypassMatch = src.match(/const\s+BYPASS_PATHS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(bypassMatch, 'BYPASS_PATHS must remain a top-level array');
  const bypassList = bypassMatch[1];
  const FORBIDDEN_BYPASS = [
    '/v1/buildings',
    '/v1/tasks',
    '/v1/audit',
    '/v1/approvals',
    '/v1/reactive',
    '/v1/cleaning',
    '/v1/triage',
    '/v1/admin',
    '/v1/notifications/devices', // requires a tenant — devices alias
    '/v1/notifications/rules',
    '/v1/notifications/templates',
  ];
  for (const path of FORBIDDEN_BYPASS) {
    assert.ok(
      !bypassList.includes(`'${path}'`) && !bypassList.includes(`"${path}"`),
      `${path} must NOT be in BYPASS_PATHS — it is a tenant-scoped route`,
    );
  }
});
