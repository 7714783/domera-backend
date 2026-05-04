// Buildings slug + tech-id contract pin (2026-05-04).
//
// The slugify function used to fail closed for non-ASCII names: a
// Hebrew / Cyrillic / Arabic / CJK input would strip down to ''
// or '-' after the /[^\w\s-]/ filter, then return the shared 'building'
// fallback. This caused two problems:
//
//   1. URL `/<locale>/buildings/-/settings?fresh=1` for any name made
//      of pure non-Latin characters.
//   2. Two such buildings would collide on the shared 'building'
//      slug and the second create would 400.
//
// The fix: when slugify produces empty / all-dash / no-letters-or-digits
// output, generate a tech id `bld-<6 hex>` per call. Same idea for the
// buildingCode field — auto-fill with `BLD-<6 hex>` (uppercase, "code-
// shaped") if the user didn't supply one.
//
// This pin is source-level: it asserts the SHAPE of the fix in the
// buildings.service.ts so a refactor can't silently undo it.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, '..', 'src');
const service = readFileSync(join(apiSrc, 'modules', 'buildings', 'buildings.service.ts'), 'utf8');

test('slugify strips leading/trailing dashes', () => {
  // Without the leading/trailing strip, an input like "  -- abc -- "
  // produced "-abc-" which then survived as the slug. Pin the strip
  // so the result is always trimmed cleanly.
  assert.match(
    service,
    /\.replace\(\s*\/\^-\+\|-\+\$\/g,\s*['"]['"]\)/,
    'slugify must strip leading/trailing dashes',
  );
});

test('slugify falls back to tech id when result has no letters or digits', () => {
  // The pin: empty cleaned output OR no a-z/0-9 character → call
  // generateTechId('bld'). This is what protects Hebrew / Cyrillic
  // / Arabic / CJK names from collapsing to '-' or 'building'.
  assert.match(
    service,
    /if \(!cleaned \|\| !\/\[a-z0-9\]\/\.test\(cleaned\)\) \{\s*return this\.generateTechId\(['"]bld['"]\);/,
    'slugify must call generateTechId("bld") when cleaned output has no [a-z0-9] characters',
  );
});

test('generateTechId uses crypto.randomBytes (not Math.random)', () => {
  // randomBytes(3) → 6 hex chars. Math.random would be predictable
  // and produce duplicates under load. Pin the crypto path.
  assert.match(
    service,
    /import \{ randomBytes \} from ['"]node:crypto['"]/,
    'must import randomBytes from node:crypto',
  );
  assert.match(
    service,
    /generateTechId\(prefix:\s*string\):\s*string\s*\{\s*return\s*`\$\{prefix\}-\$\{randomBytes\(3\)\.toString\(['"]hex['"]\)\}`/,
    'generateTechId must format `<prefix>-<randomBytes(3) hex>`',
  );
});

test('buildingCode auto-fills with BLD-<hex> when not supplied', () => {
  // Same fallback shape, uppercase prefix because buildingCode is the
  // "code-shaped" field rendered as a label in the UI.
  assert.match(
    service,
    /buildingCode:\s*body\.buildingCode\s*\|\|\s*this\.generateTechId\(['"]BLD['"]\)\.toUpperCase\(\)/,
    'create() must auto-fill buildingCode with this.generateTechId("BLD").toUpperCase() when body.buildingCode is missing',
  );
});

test('legacy "building" shared fallback is gone', () => {
  // The old code returned the literal 'building' for empty results.
  // If a refactor reintroduces this shared string two non-Latin
  // buildings would collide on slug. This pin keeps the new
  // distinct-per-call path.
  assert.doesNotMatch(
    service,
    /\.slice\(0,\s*60\)\s*\|\|\s*['"]building['"]/,
    'slugify must NOT return the shared literal "building" fallback — would collide on second non-Latin name',
  );
});
