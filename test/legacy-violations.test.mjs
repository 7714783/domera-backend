// INIT-010 legacy audit — pinned registry of contractual debt.
//
// Three counts are pinned exactly. CI fails when any count INCREASES
// (regression — new debt without remediation). DECREASE is fine and
// expected as follow-up PRs land.
//
// To shrink: close a violation, then update the pinned number in this
// file in the same PR.
// To grow: forbidden. Open a remediation PR first.
//
// Contract for what counts:
//   · RFC_RETRO_PENDING — modules without docs/modules/<name>/RFC.md
//     allowed via apps/api/test/module-rfc.test.mjs RETRO_RFC_PENDING set.
//   · RLS_KNOWN_GAPS — tenant-scoped tables without RLS allowed via
//     apps/api/test/rls.migration.test.mjs KNOWN_GAPS set.
//   · OWNERSHIP_DUAL_WRITERS — entities with > 1 owner module in
//     apps/api/test/ssot-ownership.test.mjs OWNERSHIP map. Each is a
//     transitional dual-writer and should collapse to 1 long-term.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// 2026-04-28 baseline — INIT-010 entry state, then Follow-up A applied.
const PINNED = {
  // 35 → 30 (P1 RFCs landed in the main PR) → 0 (Follow-up A wrote
  // baseline RFCs for the remaining 30 modules via
  // scripts/write-retro-rfcs.mjs). Pin is now 0; any new module
  // shipped without an RFC fails the gate immediately.
  rfcRetroPending: 0,
  rlsKnownGaps: 3,            // 4 → 3 (lease_allocations closed)
  // Dual-writer baseline at INIT-010 audit start: each documented in §3
  // of docs/architecture/INIT-010-legacy-violations-2026-04-28.md.
  // INIT-010 Follow-up B (2026-04-28): notification collapsed (10 → 9)
  // — PPM SLA worker now calls NotificationsService.recordInAppNotification.
  // Remaining buckets (9 entries):
  //   buildingOccupantCompany (3) · buildingUnitOccupancy (2) ·
  //   buildingContract (2) · taskInstance (3) · incident (2) ·
  //   serviceRequest (2) · completionRecord (3) ·
  //   teamMember (2) · teamMemberRoleAssignment (3)
  ownershipDualWriters: 9,
};

// Allow a small grace margin for normal PR churn (e.g. adding a new
// RETRO_RFC_PENDING module while waiting on its RFC). Beyond +0 we fail.
const ALLOW_OVER = 0;

function countSetEntries(filePath, setName) {
  const src = readFileSync(filePath, 'utf8');
  const re = new RegExp(`const\\s+${setName}\\s*=\\s*new\\s+Set\\(\\[([\\s\\S]*?)\\]\\)`);
  const m = src.match(re);
  if (!m) return null;
  const body = m[1];
  return [...body.matchAll(/'([^']+)'/g)].length;
}

function countDualWriterOwnership(filePath) {
  // Parse OWNERSHIP map and count entries whose value is an array of
  // length > 1. We use a forgiving regex — any entry with `[...]` value
  // counts; comments / single-string values are skipped.
  const src = readFileSync(filePath, 'utf8');
  const start = src.indexOf('const OWNERSHIP =');
  if (start < 0) return null;
  const end = src.indexOf('\n};', start);
  const block = src.slice(start, end);
  let dual = 0;
  const lines = block.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    // shape: `name: ['a', 'b'],` or `name: ['a', 'b', 'c'],`
    const m = trimmed.match(/^[a-zA-Z][\w]*\s*:\s*\[([^\]]+)\]/);
    if (!m) continue;
    const items = [...m[1].matchAll(/'[^']+'/g)];
    if (items.length > 1) dual++;
  }
  return dual;
}

const rfcCount = countSetEntries(
  join(here, 'module-rfc.test.mjs'),
  'RETRO_RFC_PENDING',
);
const rlsCount = countSetEntries(
  join(here, 'rls.migration.test.mjs'),
  'KNOWN_GAPS',
);
const ownCount = countDualWriterOwnership(
  join(here, 'ssot-ownership.test.mjs'),
);

test('RETRO_RFC_PENDING count is at or below the pinned baseline', () => {
  assert.notEqual(rfcCount, null, 'parser drift: cannot find RETRO_RFC_PENDING');
  assert.ok(
    rfcCount <= PINNED.rfcRetroPending + ALLOW_OVER,
    `RETRO_RFC_PENDING grew to ${rfcCount} (pinned ${PINNED.rfcRetroPending}). Write the missing RFC, OR if intentional debt, lower the pin in legacy-violations.test.mjs and explain in the legacy-violations doc.`,
  );
});

test('RLS KNOWN_GAPS count is at or below the pinned baseline', () => {
  assert.notEqual(rlsCount, null, 'parser drift: cannot find KNOWN_GAPS');
  assert.ok(
    rlsCount <= PINNED.rlsKnownGaps + ALLOW_OVER,
    `RLS KNOWN_GAPS grew to ${rlsCount} (pinned ${PINNED.rlsKnownGaps}). Add a migration with ENABLE/FORCE/policy, or if it's an intentional exemption (mixed system+tenant rows), lower the pin and document in INIT-010 doc.`,
  );
});

test('OWNERSHIP transitional dual-writers count is at or below the pinned baseline', () => {
  assert.notEqual(ownCount, null, 'parser drift: cannot parse OWNERSHIP map');
  assert.ok(
    ownCount <= PINNED.ownershipDualWriters + ALLOW_OVER,
    `OWNERSHIP dual-writer count grew to ${ownCount} (pinned ${PINNED.ownershipDualWriters}). Each entry with > 1 owner is transitional — refactor toward a single owner or document the legitimate split in the legacy-violations doc.`,
  );
});

test('parser sanity — counts are non-negative integers', () => {
  for (const [k, v] of Object.entries({ rfcCount, rlsCount, ownCount })) {
    assert.ok(typeof v === 'number' && v >= 0, `${k} parsed as ${v}`);
  }
});
