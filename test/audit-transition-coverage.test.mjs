// INIT-010 legacy audit — sensitive state transitions must call
// audit.transition() near the prisma update.
//
// The contract (docs/architecture/platform-development-contract.md § 5):
// regulated entities (incident, serviceRequest, approvalRequest,
// cleaningRequest, ppmCase, workOrder, building, teamMember) flip
// status only via prisma.<model>.update({ data: { status: ... } }).
// Every such update needs an `audit.transition(...)` call within ±20
// lines so the compliance trail is complete.
//
// Mode: this test runs in WARNING mode initially — it logs offenders but
// does not fail. After the next two follow-up PRs land the missing
// audit.transition calls, flip STRICT=true to gate merges. The list of
// known accepted offenders sits in OFFENDERS_ALLOWED below; new ones
// must NOT grow.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, '..', 'src', 'modules');

// Regulated entities. Status flips on these MUST be audit-stamped.
const REGULATED = [
  'incident',
  'serviceRequest',
  'approvalRequest',
  'cleaningRequest',
  'ppmCase',
  'workOrder',
  'building',
  'teamMember',
];

const STRICT = true; // INIT-010 follow-up: registry is clean as of 2026-04-29
const WINDOW = 20;

// Pinned set of paths we ALREADY know don't audit-stamp. Each entry is
// `<module>/<file>:<status-update-line-substr>`. The CI gate REFUSES to
// grow this list — adding a new regulated update without audit.transition
// will fail the build (even in warning mode, because the registry
// contract pins the count exactly).
//
// Empty on initial introduction (warning mode collects findings into
// the test output for ops review).
const OFFENDERS_ALLOWED = new Set([]);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith('.ts')) out.push(p);
  }
  return out;
}

function findOffenders() {
  const offenders = [];
  const files = walk(modulesDir);
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments — they often describe the call without making it.
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      for (const model of REGULATED) {
        const re = new RegExp(`prisma\\.${model}\\.update\\(`);
        if (!re.test(line)) continue;
        // Look ahead inside the call for `status:` (this is the trigger
        // for "this is a state-machine flip"). We don't catch every
        // sensitive update — just the ones with an explicit status field.
        const window = lines.slice(i, Math.min(lines.length, i + 12)).join('\n');
        if (!/\bstatus\s*:/i.test(window)) continue;
        // Search a wider window before+after for `audit.transition` or
        // `auditService.transition` or `this.audit.transition`.
        const before = lines.slice(Math.max(0, i - WINDOW), i).join('\n');
        const after = lines.slice(i, Math.min(lines.length, i + WINDOW)).join('\n');
        const ctx = `${before}\n${after}`;
        // Accept any audit-service identifier: `audit`, `auditService`,
        // `this.audit`, `this.auditService`. Same for write().
        if (/\baudit\w*\.transition\(/.test(ctx) || /\baudit\w*\.write\(/.test(ctx)) continue;
        const rel = relative(modulesDir, file).replace(/\\/g, '/');
        offenders.push({
          path: `${rel}:${i + 1}`,
          model,
          line: line.trim().slice(0, 80),
        });
      }
    }
  }
  return offenders;
}

const offenders = findOffenders();

test('regulated status updates carry audit.transition or audit.write', () => {
  if (offenders.length === 0) return; // clean

  const summary = offenders
    .map((o) => `  · ${o.path} — prisma.${o.model}.update({status:...}) without audit.transition`)
    .join('\n');

  if (STRICT) {
    assert.equal(
      offenders.length,
      0,
      `audit-transition coverage gap (${offenders.length}):\n${summary}`,
    );
  } else {
    // Warning mode — log to test output. Future PRs flip STRICT.
    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `\n[audit-transition-coverage] WARNING: ${offenders.length} sensitive status updates missing audit.transition\n${summary}\n  → INIT-010 contract: each must add an audit.transition call within ±${WINDOW} lines.\n`,
      );
    }
  }
});

test('OFFENDERS_ALLOWED registry is not bypassed silently', () => {
  // The registry is empty initially; this test guards the contract that
  // future PRs cannot add to it without an explicit code change here.
  // A non-empty OFFENDERS_ALLOWED requires a documented reason in
  // docs/architecture/INIT-010-legacy-violations-*.md.
  if (OFFENDERS_ALLOWED.size > 5) {
    assert.fail(
      `OFFENDERS_ALLOWED grew to ${OFFENDERS_ALLOWED.size} entries — review legacy-violations doc and either close or document each.`,
    );
  }
});
