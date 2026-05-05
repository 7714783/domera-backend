// 2026-05-05 dashboard KPI consolidation pin.
//
// OpsOverview used to fan out to 5 separate building-scoped endpoints
// on every dashboard load (ppm/programs, ppm/calendar, approvals,
// service-requests, incidents) — each opening its own RLS transaction
// because of the auto-wrap. This pin keeps the consolidation honest:
//
//   1. role-dashboards.buildingManagerToday returns a kpiCounts block
//      with the 6 canonical counters the dashboard tiles read.
//   2. All 6 counters are gathered inside the SAME withTenant batch
//      as the rest of buildingManagerToday's reads — one RLS
//      transaction for the whole dashboard request.
//   3. The kpiCounts shape stays stable: the frontend reads exact
//      keys, a rename here = silent zero on the dashboard tile.
//
// Source-level pin only. Runtime behaviour is exercised by the
// existing api test suite.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, '..', 'src');

const service = readFileSync(
  join(apiSrc, 'modules', 'role-dashboards', 'role-dashboards.service.ts'),
  'utf8',
);

const KPI_KEYS = [
  'ppmPrograms',
  'ppmOverdue',
  'ppmDue30',
  'approvalsPending',
  'servicesOpen',
  'incidentsOpen',
];

test('buildingManagerToday return shape declares kpiCounts with all 6 keys', () => {
  const m = service.match(/kpiCounts:\s*\{([\s\S]*?)\}/);
  assert.ok(m, 'buildingManagerToday return must include a kpiCounts: { … } block');
  const body = m[1];
  for (const k of KPI_KEYS) {
    assert.match(
      body,
      new RegExp(`\\b${k}:`),
      `kpiCounts must declare key '${k}' so the frontend dashboard tile can read it`,
    );
  }
});

test('all 6 KPI counters live inside the same withTenant batch', () => {
  // Pin: every counter is computed inside the role-dashboards
  // buildingManagerToday withTenant block, not after it. If a refactor
  // pulls one out into a separate this.prisma.* call, we'd be back to
  // an extra RLS transaction per request.
  const blockStart = service.indexOf("'role-dashboards.buildingManagerToday'");
  assert.ok(blockStart > 0, 'withTenant block tag for buildingManagerToday must be present');
  const blockBeginning = service.indexOf('await this.prisma.withTenant(');
  assert.ok(blockBeginning > 0 && blockBeginning < blockStart, 'withTenant call must precede tag');
  const block = service.slice(blockBeginning, blockStart);

  for (const counter of [
    'ppmProgramsCount',
    'ppmOverdueCount',
    'ppmDue30Count',
    'approvalsPendingCount',
    'servicesOpenCount',
    'incidentsOpenCount',
  ]) {
    assert.match(
      block,
      new RegExp(`const ${counter}\\s*=\\s*await tx\\.`),
      `${counter} must be computed inside the withTenant tx block (not after)`,
    );
  }
});

test('counter queries scope by tenantId + buildingId', () => {
  // Belt-and-suspenders: RLS auto-wrap is bypassed inside withTenant
  // (we issue queries on tx, which lacks the $allOperations hook),
  // but tx still inherits the set_config from the outer transaction.
  // Explicit tenantId in every where clause is the second line of
  // defence in case a refactor stops calling withTenant correctly.
  const counterRegex =
    /const (?:ppmPrograms|ppmOverdue|ppmDue30|approvalsPending|servicesOpen|incidentsOpen)Count\s*=\s*await tx\.[a-zA-Z]+\.count\(\s*\{[\s\S]*?\}\s*\)/g;
  const matches = service.match(counterRegex) || [];
  assert.equal(matches.length, 6, `expected 6 counter queries, got ${matches.length}`);
  for (const q of matches) {
    assert.match(
      q,
      /tenantId,?\s+buildingId/,
      `counter query must scope by both tenantId and buildingId: ${q.slice(0, 80)}…`,
    );
  }
});

test('ppmDue30Count uses [now, in30] window — not just nextDueAt < in30', () => {
  // Subtle correctness pin: ppmDue30 means "due within 30 days from
  // today, but not already overdue". A query with only `nextDueAt:
  // { lte: in30 }` would double-count overdue items into ppmDue30.
  // The fix is gte: now AND lte: in30.
  assert.match(
    service,
    /ppmDue30Count[\s\S]*?nextDueAt:\s*\{\s*gte:\s*now,\s*lte:\s*in30\s*\}/,
    "ppmDue30Count must use a [now, in30] window so overdue items aren't double-counted",
  );
});
