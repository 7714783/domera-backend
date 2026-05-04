// Buildings extended-attributes contract pin (2026-05-04).
//
// 10 MVP-relevant fields land in the existing `attributes` JSON bag
// rather than as new columns. This pin keeps three properties honest
// across refactors:
//
//   1. The 10 fields are listed in the create() body type so a future
//      refactor can't silently drop one (which would 400 with "unknown
//      property" depending on validator strictness).
//   2. create() persists every supplied extended field via
//      buildExtendedAttributes() into the `attributes` JSON column —
//      not as separate top-level data keys (would fail Prisma type
//      checks since none of these are real columns).
//   3. update() MERGES the patch with the existing attributes bag
//      instead of overwriting. A partial PATCH that touches only
//      `condition` must NOT wipe `imageUrl` / `ownerContact` / etc.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, '..', 'src');
const service = readFileSync(join(apiSrc, 'modules', 'buildings', 'buildings.service.ts'), 'utf8');

const EXTENDED_KEYS = [
  'postalCode',
  'region',
  'yearRenovated',
  'constructionType',
  'condition',
  'grossFloorArea',
  'hasFireSprinklers',
  'imageUrl',
  'ownerContact',
  'managementCompany',
];

test('create() body type declares all 10 extended fields', () => {
  // Pull the create() body annotation block and assert each key.
  const m = service.match(/async create\([\s\S]*?body:\s*\{([\s\S]*?)\},\s*\)\s*\{/);
  assert.ok(m, 'create() body annotation block not found');
  const body = m[1];
  for (const k of EXTENDED_KEYS) {
    assert.ok(
      new RegExp(`\\b${k}\\?:`).test(body),
      `create() body must declare optional field '${k}?:' so the form can submit it`,
    );
  }
});

test('buildExtendedAttributes helper exists + lists every key', () => {
  // The helper centralises the "which keys go into the JSON bag" rule.
  // If a field migrates to a real column later, the line is removed
  // here and added to the main create() data block.
  assert.match(
    service,
    /private buildExtendedAttributes\(body:\s*\{/,
    'buildExtendedAttributes(body) helper must exist',
  );
  for (const k of EXTENDED_KEYS) {
    const re = new RegExp(`if \\(body\\.${k} !== undefined\\) out\\.${k} = body\\.${k}`);
    assert.match(
      service,
      re,
      `buildExtendedAttributes must include 'if (body.${k} !== undefined) out.${k} = body.${k}'`,
    );
  }
});

test('create() persists extended attrs via attributes JSON, not as columns', () => {
  // Pin: in the prisma.building.create({ data: ... }) block, the line
  // `attributes: this.buildExtendedAttributes(body)` is present.
  // Equivalent attempts to put e.g. `condition: body.condition` at the
  // top level would explode at runtime (Prisma type error, no such
  // column).
  assert.match(
    service,
    /attributes:\s*this\.buildExtendedAttributes\(body\)/,
    'create() data block must set attributes: this.buildExtendedAttributes(body)',
  );
  // No naked `condition:` / `constructionType:` / etc. at top level
  // of the create data block (they belong in attributes).
  for (const k of [
    'condition',
    'constructionType',
    'grossFloorArea',
    'hasFireSprinklers',
    'imageUrl',
    'ownerContact',
    'managementCompany',
  ]) {
    const re = new RegExp(`^\\s+${k}:\\s*body\\.${k}`, 'm');
    assert.doesNotMatch(
      service,
      re,
      `'${k}' must NOT be a top-level prisma data key — it's a JSON-bag field`,
    );
  }
});

test('update() merges patch with existing attributes (no wipe on partial PATCH)', () => {
  // The pin: when ANY extended key is in the patch, the existing
  // attributes bag is read first and spread into `next` BEFORE the
  // patched values overwrite. A partial PATCH on `condition` alone
  // must keep `imageUrl` / `ownerContact` intact.
  assert.match(
    service,
    /const current = \(existing\.attributes as Record<string, any> \| null\) \|\| \{\};/,
    'update() must read existing.attributes before merging',
  );
  assert.match(
    service,
    /const next = \{ \.\.\.current \};\s*for \(const k of extendedKeys\) if \(k in patch\) next\[k\] = patch\[k\];/,
    'update() must spread current into next THEN overwrite per-key from patch',
  );
  assert.match(
    service,
    /data\.attributes = next;/,
    'update() must assign the merged bag to data.attributes',
  );
});

test('update() lists all 10 extended keys in extendedKeys array', () => {
  // The list must stay in sync with EXTENDED_KEYS — a new field added
  // to create() but missing here would silently fail to PATCH.
  const m = service.match(/const extendedKeys = \[([\s\S]*?)\];/);
  assert.ok(m, 'update() must declare const extendedKeys = [...]');
  const arrSrc = m[1];
  for (const k of EXTENDED_KEYS) {
    assert.match(arrSrc, new RegExp(`['"]${k}['"]`), `update() extendedKeys must include '${k}'`);
  }
});

test('extended-attrs handling does NOT touch the original column-based fields', () => {
  // Non-extended fields (e.g. yearBuilt, floorsCount, hasParking) stay
  // top-level prisma keys — pin a couple to make sure the refactor
  // didn't accidentally move them into the JSON bag.
  for (const k of ['yearBuilt', 'floorsCount', 'hasParking', 'unitsCount']) {
    const re = new RegExp(`${k}:\\s*body\\.${k}`);
    assert.match(
      service,
      re,
      `'${k}' must STAY a top-level prisma data key — it has its own column`,
    );
  }
});
