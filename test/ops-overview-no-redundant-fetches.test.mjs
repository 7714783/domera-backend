// 2026-05-05 — pin OpsOverview.
//
// Frontend pages used to refetch /v1/auth/me + /v1/onboarding/my-workspaces +
// /v1/buildings on every mount because there was no shared bootstrap
// store. AppShell was already loading them, so every page added 3
// duplicate requests on top. This pin keeps OpsOverview honest after
// the BootstrapContext refactor:
//
//   1. OpsOverview reads useBootstrap() — no direct calls to
//      /v1/auth/me / /v1/onboarding/my-workspaces / /v1/buildings.
//   2. The 5 building-scoped fan-out (ppm/programs, ppm/calendar,
//      approvals, service-requests, incidents) collapsed into ONE
//      call to /v1/role-dashboards/building-manager/:slug.
//
// If a refactor re-introduces any of the 8 forbidden endpoints,
// the gate fails and the engineer either rebuilds the consolidation
// or updates the pin (and explains why in a commit comment).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const opsPagePath = join(
  repoRoot,
  'apps',
  'frontend',
  'src',
  'components',
  'domera',
  'pages',
  'ops-overview.tsx',
);

// Skip cleanly when running outside the monorepo (split slice
// doesn't carry frontend source).
import { existsSync } from 'node:fs';
if (!existsSync(opsPagePath)) {
  test('ops-overview pin skipped (frontend not co-located)', { skip: true }, () => {});
} else {
  runPins();
}

function runPins() {
  const src = readFileSync(opsPagePath, 'utf8');

  test('OpsOverview reads bootstrap data via useBootstrap()', () => {
    assert.match(
      src,
      /import \{ useBootstrap \} from ['"]\.\.\/\.\.\/\.\.\/lib\/bootstrap-context['"]/,
      'OpsOverview must import useBootstrap from the bootstrap-context module',
    );
    assert.match(
      src,
      /const bootstrap = useBootstrap\(\)/,
      'OpsOverview must call useBootstrap() inside the component to read shared state',
    );
  });

  test('OpsOverview does NOT call the 3 bootstrap endpoints directly', () => {
    // These are exactly the calls AppShell already makes — refetching
    // them from a page is the duplication this commit fixes.
    for (const path of ['/v1/auth/me', '/v1/onboarding/my-workspaces', '/v1/buildings']) {
      // The bare path '/v1/buildings' would also match
      // '/v1/buildings/:slug/...' which OpsOverview legitimately
      // doesn't use either, so plain string contains is fine here.
      // But we want to forbid the EXACT bootstrap path, not the
      // building-scoped sub-paths under it.
      const re =
        path === '/v1/buildings'
          ? /apiRequest[^(]*\([^,)]*['"`]\/v1\/buildings['"`]/
          : new RegExp(`apiRequest[^(]*\\([^,)]*['"\`]${path.replace(/\//g, '\\/')}`);
      assert.doesNotMatch(
        src,
        re,
        `OpsOverview must not call ${path} directly — read from useBootstrap() instead`,
      );
    }
  });

  test('OpsOverview does NOT call the 5 forbidden building-scoped fan-out endpoints', () => {
    // Match only inside apiRequest(...) call sites — the comment block
    // explaining the historical fan-out names these paths legitimately,
    // and we don't want the pin to trip on documentation.
    const forbiddenPathRegexes = [
      /apiRequest[\s\S]*?\/ppm\/programs/,
      /apiRequest[\s\S]*?\/ppm\/calendar/,
      /apiRequest[^(]*\(\s*['"`]\/v1\/approvals['"`]/,
      /apiRequest[\s\S]*?\/service-requests/,
      /apiRequest[\s\S]*?\/incidents['"`]/,
    ];
    for (const re of forbiddenPathRegexes) {
      assert.doesNotMatch(
        src,
        re,
        `OpsOverview must not call this endpoint via apiRequest — KPIs come from /v1/role-dashboards/building-manager/:slug instead. Tripped on ${re}`,
      );
    }
  });

  test('OpsOverview reads kpiCounts from /v1/role-dashboards/building-manager/:slug', () => {
    assert.match(
      src,
      /\/v1\/role-dashboards\/building-manager\/\$\{firstBuildingSlug\}/,
      'OpsOverview must hit /v1/role-dashboards/building-manager/${firstBuildingSlug} for KPIs',
    );
    // Read every key the kpiCounts contract promises so a renamed
    // backend key would surface here, not as a silent zero on the
    // dashboard tile.
    for (const k of [
      'ppmPrograms',
      'ppmOverdue',
      'ppmDue30',
      'approvalsPending',
      'servicesOpen',
      'incidentsOpen',
    ]) {
      assert.match(
        src,
        new RegExp(`k\\.${k}\\s*\\?\\?\\s*0`),
        `OpsOverview must read kpiCounts.${k} ?? 0 from the dashboard response`,
      );
    }
  });
}
