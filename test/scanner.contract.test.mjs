// GROWTH-001 NS-24 — pin the scanner module contract.
//
// Mobile (apps/mobile/src/scanner/scannerApi.ts) calls
// POST /v1/scanner/resolve { token }. The server is the SOLE
// authority on what a token means — adding a new scan kind is a
// server change, not a client change. This pin keeps that
// contract honest under refactor:
//
//   1. Controller mounted at /scanner/resolve.
//   2. Service exposes resolve(tenantId, token) returning the
//      typed union with the four canonical kinds.
//   3. All four `kind` literals appear in the source.
//   4. Token validation regex is present (refuses garbage early).
//   5. UUID short-circuit happens BEFORE the asset/task lookup
//      (otherwise non-UUID misses do two extra DB calls per scan).
//   6. Resolution order — cleaning_qr_points BEFORE qr_locations
//      BEFORE asset BEFORE task. Order matters: if assets/tasks
//      went first, a UUID that happens to match an asset id but is
//      ALSO a printed task slip would hit the wrong row.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, '..', 'src');

const controller = readFileSync(
  join(apiSrc, 'modules', 'scanner', 'scanner.controller.ts'),
  'utf8',
);
const service = readFileSync(join(apiSrc, 'modules', 'scanner', 'scanner.service.ts'), 'utf8');

test('controller mounted at /scanner with /resolve route', () => {
  assert.match(controller, /@Controller\(\s*['"]scanner['"]\s*\)/);
  assert.match(controller, /@Post\(\s*['"]resolve['"]\s*\)/);
});

test('controller is rate-limited per IP', () => {
  assert.match(
    controller,
    /rateLimit\(\{\s*key:\s*`scanner:resolve:\$\{ip\}`/,
    'POST /v1/scanner/resolve must be rate-limited per IP (token brute-force defense)',
  );
});

test('service exports the 4 canonical scan kinds in ResolvedScanTarget', () => {
  for (const kind of ['cleaning_request_form', 'location', 'asset', 'task']) {
    const re = new RegExp(`kind:\\s*['"]${kind}['"]`);
    assert.match(
      service,
      re,
      `ResolvedScanTarget union arm '${kind}' must be present in scanner.service.ts`,
    );
  }
});

test('token regex refuses garbage early', () => {
  // Length 4-128, base64url-style charset. If this widens to allow
  // arbitrary chars, the DB ends up running findFirst on user-
  // controlled strings — not a SQL-injection issue (Prisma binds)
  // but a wasted DB call per scan.
  assert.match(service, /TOKEN_RE\s*=\s*\/\^\[A-Za-z0-9_-\]\{4,128\}\$\//);
  assert.match(
    service,
    /if \(!TOKEN_RE\.test\(t\)\)/,
    'service must reject tokens that fail TOKEN_RE before any DB call',
  );
});

test('UUID short-circuit happens before asset/task lookup', () => {
  // Pin: between qrLocation lookup and asset lookup, the service
  // must check UUID_RE and 404 if the token is non-UUID. Otherwise
  // every cleaning-style code that reached step 3 would do an
  // asset.findFirst lookup that can't possibly hit (asset.id is a
  // UUID) — wasted work.
  assert.match(
    service,
    /qrLocation\.findFirst[\s\S]*?if \(!UUID_RE\.test\(t\)\)[\s\S]*?asset\.findFirst/,
    'service must short-circuit on UUID_RE between qrLocation and asset lookups',
  );
});

test('resolution order is cleaning → location → asset → task', () => {
  // The order of these findFirst calls must not change without
  // re-evaluating the contract. cleaningQrPoint (public-shape codes)
  // FIRST so its short codes never get accidentally swallowed by a
  // qrLocation match. asset BEFORE task so a UUID that happens to
  // be both an asset id AND a task id resolves to the asset
  // (assets are the printed-tag use case; tasks are printed slips).
  const idxClean = service.indexOf('cleaningQrPoint.findFirst');
  const idxLoc = service.indexOf('qrLocation.findFirst');
  const idxAsset = service.indexOf('asset.findFirst');
  const idxTask = service.indexOf('taskInstance.findFirst');
  assert.ok(idxClean > 0, 'cleaningQrPoint.findFirst missing');
  assert.ok(idxLoc > idxClean, 'qrLocation.findFirst must come AFTER cleaningQrPoint.findFirst');
  assert.ok(idxAsset > idxLoc, 'asset.findFirst must come AFTER qrLocation.findFirst');
  assert.ok(idxTask > idxAsset, 'taskInstance.findFirst must come AFTER asset.findFirst');
});

test('every prisma read is tenant-scoped', () => {
  // Belt-and-suspenders: RLS auto-wrap already filters cross-tenant,
  // but we keep tenantId in the where clauses explicitly so a future
  // refactor that bypasses RLS (e.g. moves to migrator client) does
  // not silently leak.
  const reads = service.match(/\.findFirst\(\s*\{\s*where:\s*\{[^}]+\}/g) || [];
  assert.ok(reads.length >= 4, `expected ≥4 findFirst calls, got ${reads.length}`);
  for (const r of reads) {
    assert.ok(
      /tenantId/.test(r),
      `every findFirst must include tenantId in where: ${r.slice(0, 80)}…`,
    );
  }
});

test('not-found path throws NotFoundException, not silent null', () => {
  // The mobile client treats 404 as "show error toast"; a null/undefined
  // response would crash the client union-type narrowing.
  assert.match(
    service,
    /throw new NotFoundException\(['"]token did not resolve to a known scan target['"]\)/,
    'final fallback must throw NotFoundException with a stable message',
  );
});
