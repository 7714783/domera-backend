// Module RFC presence guard.
//
// Pinned by docs/architecture/platform-development-contract.md § 11.
// Every folder under apps/api/src/modules/ MUST have a matching RFC at
// docs/modules/<folder-name>/RFC.md before it can ship. This catches the
// "ship a module without writing the contract" smell.
//
// EXCEPTIONS list at the top — modules that pre-date the contract and
// are scheduled for retro-RFC. New module folders may NOT be added to
// the exception list without architecture-owner approval.
//
// Run: `node --test apps/api/test/module-rfc.test.mjs`

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, '..', 'src', 'modules');
const docsDir = join(here, '..', '..', '..', 'docs', 'modules');

// Modules that exist today and need a retro-RFC. Each row is a debt the
// architecture team explicitly tracks. New modules may NOT join this
// list — they must ship with an RFC from day one.
//
// To remove an entry: write the RFC at docs/modules/<name>/RFC.md.
//
// 2026-04-26 (INIT-010 Phase 1 / Task 4): top-12 RFCs landed —
// approvals, assets, assignment, audit, building-core, cleaning,
// contractor-companies, documents, iam, ppm, reactive, tenant-companies.
const RETRO_RFC_PENDING = new Set([
  'auth',
  'buildings',
  'calendar-blackouts',
  'compliance',
  'compliance-profiles',
  'condition-triggers',
  'connectors',
  'devices',
  'document-links',
  'document-templates',
  'emergency-overrides',
  'events',
  'health',
  'imports',
  'inventory',
  'leases',
  'metrics',
  'mfa',
  'obligations',
  'occupants',
  'onboarding',
  'organizations',
  'privacy',
  'projects',
  'public-qr',
  'qr-locations',
  'role-dashboards',
  'rounds',
  'scim',
  'seed-runtime',
  'sso',
  'takeover',
  'tasks',
  'tenancy',
  'vendor-invoices',
  'webhooks',
]);

const folders = readdirSync(modulesDir).filter((f) => {
  const p = join(modulesDir, f);
  return statSync(p).isDirectory();
});

test('every module folder has docs/modules/<name>/RFC.md (or is in RETRO_RFC_PENDING)', () => {
  const missing = [];
  for (const f of folders) {
    const rfc = join(docsDir, f, 'RFC.md');
    if (existsSync(rfc)) continue;
    if (RETRO_RFC_PENDING.has(f)) continue;
    missing.push(f);
  }
  if (missing.length > 0) {
    assert.fail(
      `${missing.length} module folder(s) without RFC:\n` +
        missing.map((m) => `  · ${m}  → expected docs/modules/${m}/RFC.md`).join('\n') +
        `\n\nFix: copy docs/modules/_template/RFC.md to that path and fill it in.\n` +
        `If this is a pre-existing module, add it to RETRO_RFC_PENDING in this test file ` +
        `(architecture-owner approval required — see CODEOWNERS).`,
    );
  }
});

test('RETRO_RFC_PENDING entries still exist as module folders', () => {
  // Drift catch: if a folder is removed but stays in RETRO_RFC_PENDING, the
  // exception list silently grows stale. Force its cleanup.
  const stale = [...RETRO_RFC_PENDING].filter((m) => !folders.includes(m));
  assert.equal(
    stale.length,
    0,
    `RETRO_RFC_PENDING contains stale entries: ${stale.join(', ')}\n` +
      `Remove them — the modules no longer exist.`,
  );
});

test('docs/modules/_template/RFC.md exists (so new modules can copy it)', () => {
  const tpl = join(docsDir, '_template', 'RFC.md');
  assert.ok(existsSync(tpl), `RFC template missing at ${tpl}`);
});
