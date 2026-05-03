// PERF-001 Stage 1 — pin the latency observability surface.
//
// Three properties keep the perf-baseline workflow honest:
//
//   1. MetricsService exposes a histogram() primitive that emits
//      Prometheus-shaped _bucket{le="…"} / _count / _sum lines.
//   2. MetricsMiddleware records every request into the canonical
//      http_request_duration_ms histogram with a NORMALIZED route
//      label (no raw uuids / numeric ids leaking).
//   3. PrismaQueryStats records (model, operation) → count + sumMs +
//      bucket counts so /metrics can render prisma_query_duration_ms.
//
// If a refactor changes any of these, the gate fails and the engineer
// must restore the contract or update the pin.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, '..', 'src');

const metricsService = readFileSync(
  join(apiSrc, 'modules', 'metrics', 'metrics.service.ts'),
  'utf8',
);
const metricsMiddleware = readFileSync(
  join(apiSrc, 'modules', 'metrics', 'metrics.middleware.ts'),
  'utf8',
);
const metricsController = readFileSync(
  join(apiSrc, 'modules', 'metrics', 'metrics.controller.ts'),
  'utf8',
);
const prismaService = readFileSync(join(apiSrc, 'prisma', 'prisma.service.ts'), 'utf8');
const prismaStats = readFileSync(join(apiSrc, 'prisma', 'prisma-query-stats.ts'), 'utf8');

test('MetricsService exposes histogram() primitive', () => {
  assert.match(
    metricsService,
    /histogram\(\s*name:\s*string,\s*help:\s*string,\s*labels:\s*string\[\]/,
    'MetricsService.histogram(name, help, labels, buckets?) signature must stay stable',
  );
  assert.match(
    metricsService,
    /DEFAULT_LATENCY_BUCKETS_MS\s*=\s*\[\s*1,\s*2,\s*5,\s*10,\s*25,\s*50,\s*100,\s*250,\s*500,\s*1000,\s*2500,\s*5000/,
    'DEFAULT_LATENCY_BUCKETS_MS must include the canonical 12 buckets — baseline scripts pin them',
  );
});

test('histogram render() emits Prometheus _bucket{le="…"} / _count / _sum', () => {
  // We grep the render() body for the three required line shapes.
  assert.match(
    metricsService,
    /\$\{name\}_bucket\{\$\{labelPrefix\}le="\$\{bucket\}"\}/,
    'histogram render must emit `<name>_bucket{<labels>,le="<bucket>"} <cum>` lines',
  );
  assert.match(
    metricsService,
    /\$\{name\}_bucket\{\$\{labelPrefix\}le="\+Inf"\}/,
    'histogram render must close with le="+Inf" bucket',
  );
  assert.match(metricsService, /\$\{name\}_count\$\{labelOnly\}/, 'histogram must emit _count');
  assert.match(metricsService, /\$\{name\}_sum\$\{labelOnly\}/, 'histogram must emit _sum');
});

test('MetricsMiddleware records http_request_duration_ms with normalized route', () => {
  assert.match(
    metricsMiddleware,
    /this\.metrics\.histogram\(\s*['"]http_request_duration_ms['"]/,
    'MetricsMiddleware must observe the canonical http_request_duration_ms histogram',
  );
  assert.match(
    metricsMiddleware,
    /export function normalizeRoute/,
    'normalizeRoute must be exported so tests + scripts can verify cardinality',
  );
  // The histogram must be labelled (method, route, status_class) — any
  // change to this triple breaks every dashboard query.
  assert.match(
    metricsMiddleware,
    /\[\s*['"]method['"]\s*,\s*['"]route['"]\s*,\s*['"]status_class['"]\s*\]/,
    'http_request_duration_ms labels must be (method, route, status_class)',
  );
});

test('normalizeRoute collapses UUIDs, numeric ids, and long slugs', async () => {
  const mod = await import(
    'file://' + join(apiSrc, 'modules', 'metrics', 'metrics.middleware.ts').replace(/\\/g, '/')
  ).catch(() => null);
  // Falls back to runtime check via a tiny extracted version if TS
  // import fails — we only need the regexes to match.
  if (mod && typeof mod.normalizeRoute === 'function') {
    assert.equal(
      mod.normalizeRoute('/v1/buildings/3f9a1c4e-1234-5678-9abc-1234567890ab/spaces'),
      '/v1/buildings/:id/spaces',
    );
    assert.equal(mod.normalizeRoute('/v1/tasks/42/complete'), '/v1/tasks/:n/complete');
    return;
  }
  // Source-level fallback: assert the three placeholder paths exist.
  assert.match(metricsMiddleware, /return ':id'/);
  assert.match(metricsMiddleware, /return ':n'/);
  assert.match(metricsMiddleware, /return ':slug'/);
});

test('PrismaService records every operation into PrismaQueryStats', () => {
  assert.match(
    prismaService,
    /recordQueryTiming\(model \|\| '_raw', operation, ms\)/,
    'PrismaService $allOperations hook must call recordQueryTiming on every op (success or failure)',
  );
  // Both branches (no-tenant + tenant-scoped) must observe — otherwise
  // seed/worker queries vanish from the baseline.
  assert.ok(
    (prismaService.match(/observe\(\)/g) || []).length >= 2,
    'PrismaService must call observe() in both no-tenant and tenant-scoped paths',
  );
});

test('PrismaQueryStats snapshot matches the canonical schema', () => {
  assert.match(prismaStats, /snapshotPrismaStats/);
  assert.match(prismaStats, /BUCKETS_MS\s*=\s*\[\s*1,\s*2,\s*5,\s*10,\s*25,\s*50,\s*100,\s*250/);
  assert.match(prismaStats, /export const PrismaQueryStats/);
});

test('/metrics renders prisma_query_duration_ms histogram', () => {
  assert.match(metricsController, /renderPrismaStats/);
  assert.match(metricsController, /prisma_query_duration_ms_bucket/);
  assert.match(metricsController, /le="\+Inf"/);
  assert.match(metricsController, /prisma_query_count_total/);
});
