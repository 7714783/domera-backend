// GROWTH-001 NS-18 — pin the launch-gates contract.
//
// Three properties keep the launch precondition honest:
//
//   1. perf-budget-check parses Prometheus histogram lines, derives p95
//      from cumulative bucket counts, and uses the heavy-route
//      allowlist to pick the right budget.
//   2. error-budget-check parses http_requests_total counter and
//      rejects when 5xx ratio > MAX_5XX_RATIO.
//   3. launch-gates aggregator catalogues exactly 5 gates with the
//      canonical IDs and resets the green window the moment ANY gate
//      goes red, regardless of how long it had been green.
//
// This is a source-level pin — we don't boot the API. The runtime
// behaviour is exercised by the launch-gates workflow against an
// ephemeral Postgres + booted API.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

// scripts/launch-gates.mjs lives at monorepo root and is not synced
// into the gh/domera-backend split slice (the slice mirrors only
// apps/api/**). When this test runs from the split slice the scripts
// don't exist at repoRoot — skip the whole pin file rather than fail
// noisily. The contract is enforced from the monorepo where the
// source actually lives.
const perfBudgetPath = join(repoRoot, 'scripts', 'perf-budget-check.mjs');
const errorBudgetPath = join(repoRoot, 'scripts', 'error-budget-check.mjs');
const aggregatorPath = join(repoRoot, 'scripts', 'launch-gates.mjs');

if (!existsSync(perfBudgetPath) || !existsSync(aggregatorPath)) {
  test(
    'launch-gates pin — skipped (scripts/ not co-located, running outside monorepo)',
    { skip: true },
    () => {},
  );
} else {
  runPins();
}

function runPins() {
  const perfBudget = readFileSync(perfBudgetPath, 'utf8');
  const errorBudget = readFileSync(errorBudgetPath, 'utf8');
  const aggregator = readFileSync(aggregatorPath, 'utf8');
  const authRevokeSmoke = readFileSync(join(here, 'auth-revoke.smoke.mjs'), 'utf8');

  test('perf-budget defaults: list 500ms, heavy 1000ms, min n 5', () => {
    assert.match(
      perfBudget,
      /BUDGET_LIST_MS\s*=\s*Number\(process\.env\.BUDGET_LIST_MS\s*\|\|\s*500\)/,
    );
    assert.match(
      perfBudget,
      /BUDGET_HEAVY_MS\s*=\s*Number\(process\.env\.BUDGET_HEAVY_MS\s*\|\|\s*1000\)/,
    );
    assert.match(perfBudget, /MIN_SAMPLES\s*=\s*Number\(process\.env\.MIN_SAMPLES\s*\|\|\s*5\)/);
  });

  test('perf-budget heavy-route allowlist exists and is small', () => {
    const m = perfBudget.match(/HEAVY_ROUTES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(m, 'HEAVY_ROUTES allowlist must be exported as a Set literal');
    const entries = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.ok(entries.length > 0, 'at least one heavy route must be declared');
    assert.ok(
      entries.length <= 12,
      `heavy-route allowlist should stay tight (got ${entries.length} entries)`,
    );
  });

  test('perf-budget reads http_request_duration_ms (PERF-001 metric name)', () => {
    assert.match(perfBudget, /parseHistogram\(text,\s*['"]http_request_duration_ms['"]\)/);
  });

  test('perf-budget p95 uses cumulative bucket counts, not interpolation', () => {
    // The pin: the implementation MUST pick the smallest le bucket where
    // count >= 0.95 * total. Linear interpolation inside a bucket would
    // be more accurate but harder to defend in a budget check —
    // overestimating is the right side to err on.
    assert.match(
      perfBudget,
      /target\s*=\s*series\.count\s*\*\s*0\.95/,
      'p95 target must be 0.95 × total observation count',
    );
  });

  test('error-budget defaults: 5xx ratio ≤ 1%, min total 100, blame ≥ 3', () => {
    assert.match(
      errorBudget,
      /MAX_5XX_RATIO\s*=\s*Number\(process\.env\.MAX_5XX_RATIO\s*\|\|\s*0\.01\)/,
    );
    assert.match(errorBudget, /MIN_TOTAL\s*=\s*Number\(process\.env\.MIN_TOTAL\s*\|\|\s*100\)/);
    assert.match(errorBudget, /MIN_BLAME\s*=\s*Number\(process\.env\.MIN_BLAME\s*\|\|\s*3\)/);
  });

  test('error-budget reads http_requests_total (canonical traffic counter)', () => {
    assert.match(errorBudget, /parseCounter\(text,\s*['"]http_requests_total['"]\)/);
  });

  test('aggregator catalogues exactly 5 gates with canonical IDs', () => {
    const m = aggregator.match(/const GATES\s*=\s*\[([\s\S]*?)\n\];/);
    assert.ok(m, 'GATES array must be a top-level const literal');
    const ids = [...m[1].matchAll(/id:\s*'([^']+)'/g)].map((x) => x[1]);
    assert.deepEqual(
      ids,
      ['rls-smoke', 'auth-revoke', 'post-deploy-smoke', 'perf-budget', 'error-budget'],
      'launch-gates must declare exactly the 5 canonical gate IDs in this order',
    );
  });

  test('aggregator resets greenSince on ANY gate failure', () => {
    // The whole point of the 48h timer: failures reset it
    // unconditionally. There is no partial-credit path.
    assert.match(
      aggregator,
      /if \(failed\.length > 0\)\s*\{\s*\/\/[^]*?state\.greenSince\s*=\s*null/,
      'on failure, aggregator MUST set state.greenSince = null (the green window resets)',
    );
  });

  test('aggregator caps status at "warming" when any gate is skipped', () => {
    // Skipped gates do not promote to "ready". You cannot graduate to a
    // launch-ready state with a deliberately-disabled check, even if the
    // window is fully accumulated.
    assert.match(
      aggregator,
      /skipped\.length > 0[\s\S]*?status\s*=\s*'warming'[\s\S]*?never promotes to ready/,
      'aggregator must cap status at "warming" when any gate is skipped',
    );
  });

  test('aggregator green window defaults to 48 hours', () => {
    assert.match(
      aggregator,
      /GREEN_WINDOW_HOURS\s*=\s*Number\(process\.env\.GREEN_WINDOW_HOURS\s*\|\|\s*48\)/,
      'GROWTH-001 NS-18 specifies a 48h continuous-green window',
    );
  });

  test('auth-revoke smoke probes both /v1/auth/me AND a protected route', () => {
    // Both checks matter: /v1/auth/me proves the AuthService rejects the
    // revoked token; the second protected route proves the rejection
    // happens at the verifySession layer everywhere, not just in the
    // auth controller's own handlers.
    assert.match(authRevokeSmoke, /\/v1\/auth\/me/);
    assert.match(authRevokeSmoke, /\/v1\/mfa\/status/);
    assert.match(authRevokeSmoke, /assert\.equal\(\s*r\.status,\s*401/);
  });
}
