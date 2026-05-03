// INIT-012 NS-16 — pin the asset.created → PPM auto-suggest contract.
//
// The handler in apps/api/src/modules/ppm/ppm.service.ts subscribes
// to asset.created and clones existing (templateId, obligationTemplateId)
// recipes onto a new PpmPlanItem when the new asset's systemFamily
// matches a template's domain. Source-level pin keeps three properties
// from drifting:
//
//   1. The handler must dedup by (assetId, templateId) before creating
//      a plan item — required for at-least-once outbox replay.
//   2. New plan items must land with baselineStatus='pending' so they
//      are gated behind operator confirmation on /ppm/setup.
//   3. Template-domain match must be case-insensitive (Prisma contains
//      with mode: 'insensitive') so 'HVAC' on the asset matches
//      'hvac' on a tenant-custom template.
//
// If a refactor changes any of these, the gate fails and the engineer
// must restore the contract or update the pin (and the dashboard).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const servicePath = join(here, '..', 'src', 'modules', 'ppm', 'ppm.service.ts');
const src = readFileSync(servicePath, 'utf8');

function handlerBody() {
  const start = src.indexOf("register('asset.created'");
  assert.ok(start >= 0, 'asset.created handler not found in ppm.service.ts');
  // Take a generous window — the handler body has nested {});} blocks
  // (try/catch + create + findMany) so naive close-paren matching gets
  // the wrong end. 8000 chars is comfortably bigger than the full body.
  return src.slice(start, start + 8000);
}

test('asset.created handler dedupes by (assetId, templateId) before insert', () => {
  const body = handlerBody();
  // Look for the findFirst guarding the create — must scope by both
  // tenantId+assetId+templateId so replay is a no-op.
  assert.match(
    body,
    /findFirst\(\s*\{\s*where:\s*\{\s*tenantId,?\s*assetId,?\s*templateId/s,
    'asset.created handler must call ppmPlanItem.findFirst({where:{tenantId,assetId,templateId}}) to dedup before create — required for at-least-once replay',
  );
});

test('asset.created handler creates plan items in baselineStatus="pending"', () => {
  const body = handlerBody();
  assert.match(
    body,
    /baselineStatus:\s*['"]pending['"]/,
    'asset.created auto-suggested plan items must land in baselineStatus="pending" so the operator confirms via /ppm/setup',
  );
});

test('asset.created template-domain match is case-insensitive', () => {
  const body = handlerBody();
  assert.match(
    body,
    /domain:\s*\{\s*contains:\s*systemFamily[\s\S]*?mode:\s*['"]insensitive['"]/,
    'template lookup must use { contains: systemFamily, mode: "insensitive" } so HVAC matches hvac',
  );
});

test('asset.created handler skips silently when systemFamily is missing', () => {
  const body = handlerBody();
  assert.match(
    body,
    /if\s*\(\s*!tenantId\s*\|\|\s*!buildingId\s*\|\|\s*!systemFamily\s*\)\s*\{[\s\S]*?return\s*;/,
    'handler must return early when tenantId / buildingId / systemFamily is missing — must not crash the dispatcher',
  );
});
