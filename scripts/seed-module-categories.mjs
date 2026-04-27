// One-shot seeder for INIT-013 module.meta.ts files. Reads the existing
// module folders under apps/api/src/modules/ and writes a meta file per
// folder with a category guess based on the folder name. Re-running is
// safe — files that already exist are left untouched.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'apps/api/src/modules');

// Mapping derived from the folder name. The seeder writes the FIRST match;
// modules where we'd guess wrong should be hand-edited afterwards.
const RULES = [
  // finance
  [/^(approvals|vendor-invoices|imports|leases|takeover)$/, 'finance'],
  // tech_support
  [/^(ppm|assets|building-core|condition-triggers|inventory|reactive|tasks|connectors)$/, 'tech_support'],
  // legal
  [/^(documents|document-links|document-templates|privacy|emergency-overrides|obligations)$/, 'legal'],
  // cleaning
  [/^(cleaning|rounds)$/, 'cleaning'],
  // security
  [/^(public-qr|qr-locations)$/, 'security'],
  // compliance
  [/^(compliance|compliance-profiles|audit)$/, 'compliance'],
  // operations
  [/^(buildings|tenancy|tenant-companies|projects|onboarding|occupants|calendar-blackouts)$/, 'operations'],
  // people
  [/^(auth|iam|role-dashboards|organizations|contractor-companies|sso|scim|mfa)$/, 'people'],
  // enterprise (catch-all for vendor-related)
  [/^(assignment)$/, 'tech_support'],
  // mobile
  [/^(devices)$/, 'mobile'],
  // platform
  [/^(events|health|metrics|webhooks|seed-runtime)$/, 'platform'],
];

function guess(folderName) {
  for (const [re, cat] of RULES) {
    if (re.test(folderName)) return cat;
  }
  return null;
}

const folders = fs.readdirSync(ROOT).filter((f) => {
  const p = path.join(ROOT, f);
  return fs.statSync(p).isDirectory();
});

let written = 0;
let skipped = 0;
let unknown = [];

for (const f of folders) {
  const meta = path.join(ROOT, f, 'module.meta.ts');
  if (fs.existsSync(meta)) {
    skipped++;
    continue;
  }
  const cat = guess(f);
  if (!cat) {
    unknown.push(f);
    continue;
  }
  const body = `// INIT-013 — module category. Drives the role-builder UI grouping
// and lets the workspace_owner grant a custom role access to a category
// without listing every permission individually. Required by the
// module-category-coverage CI gate.

import { MODULE_CATEGORIES } from '../../common/module-categories';

export const MODULE_CATEGORY = '${cat}' as (typeof MODULE_CATEGORIES)[number];
`;
  fs.writeFileSync(meta, body, 'utf8');
  written++;
}

console.log(`[seed-module-categories] wrote ${written}, skipped ${skipped}`);
if (unknown.length) {
  console.log(`[seed-module-categories] unmapped — please edit by hand:`);
  for (const u of unknown) console.log(`  - ${u}`);
  process.exit(1);
}
