// INIT-013 CI gate — every backend module folder MUST export a
// MODULE_CATEGORY from its `module.meta.ts`. The category MUST be one of
// the canonical values listed in apps/api/src/common/module-categories.ts.
//
// Why: custom roles are built by picking N categories then N permissions
// per category. If a module has no category, its endpoints become
// effectively un-grantable to a custom role — silent permission gap.
// This guard fails the build the moment a new module folder is added
// without a meta file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '../src/modules');

// Mirror the canonical list from src/common/module-categories.ts to avoid
// pulling TS into the test runtime. Keep these two in sync — drift is
// caught by the test below that asserts the file exists.
const CANONICAL = new Set([
  'finance',
  'tech_support',
  'legal',
  'cleaning',
  'security',
  'compliance',
  'operations',
  'people',
  'enterprise',
  'mobile',
  'platform',
]);

function readMeta(dir) {
  const file = path.join(ROOT, dir, 'module.meta.ts');
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/MODULE_CATEGORY\s*=\s*['"]([a-z_]+)['"]/);
  return m ? m[1] : null;
}

test('every module folder declares MODULE_CATEGORY in module.meta.ts', () => {
  const folders = fs.readdirSync(ROOT).filter((f) => fs.statSync(path.join(ROOT, f)).isDirectory());
  const missing = [];
  for (const f of folders) {
    if (!readMeta(f)) missing.push(f);
  }
  assert.deepEqual(missing, [], `module.meta.ts missing or malformed for: ${missing.join(', ')}`);
});

test('every declared MODULE_CATEGORY is canonical', () => {
  const folders = fs.readdirSync(ROOT).filter((f) => fs.statSync(path.join(ROOT, f)).isDirectory());
  const offenders = [];
  for (const f of folders) {
    const cat = readMeta(f);
    if (cat && !CANONICAL.has(cat)) offenders.push(`${f}=${cat}`);
  }
  assert.deepEqual(offenders, [], `non-canonical categories: ${offenders.join(', ')}`);
});

test('canonical categories file mirrors the test-side list', () => {
  const tsFile = path.resolve(path.dirname(__filename), '../src/common/module-categories.ts');
  assert.ok(fs.existsSync(tsFile), 'module-categories.ts is missing');
  const src = fs.readFileSync(tsFile, 'utf8');
  const found = [...src.matchAll(/['"]([a-z_]+)['"]/g)]
    .map((m) => m[1])
    .filter((s) => CANONICAL.has(s));
  for (const c of CANONICAL) {
    assert.ok(found.includes(c), `canonical "${c}" not present in module-categories.ts`);
  }
});
