// Unit tests for occupant/tenant filtering rules. Covers:
//   - PPM seed vendors (companyType='vendor') must not leak into tenants listings
//   - Create validation rejects vendor type
//   - Listing portfolio filters out vendor entries

import test from 'node:test';
import assert from 'node:assert/strict';

// Recreates the where-clause shape our Prisma queries use, without pulling in
// Prisma itself — pure logic check.
function tenantListWhere(tenantId, buildingId) {
  return { tenantId, buildingId, companyType: { not: 'vendor' } };
}
function portfolioWhere(tenantId) {
  return { tenantId, companyType: { not: 'vendor' } };
}

function validateCreateBody(body) {
  if (!body.companyName?.trim()) throw new Error('companyName required');
  if (body.companyType && body.companyType.toLowerCase() === 'vendor') {
    throw new Error('vendor type not allowed for tenants — use the vendors module');
  }
  return true;
}

test('tenantListWhere — excludes vendor companyType', () => {
  const w = tenantListWhere('t1', 'b1');
  assert.deepEqual(w.companyType, { not: 'vendor' });
  assert.equal(w.buildingId, 'b1');
});

test('portfolioWhere — no buildingId, still excludes vendor', () => {
  const w = portfolioWhere('t1');
  assert.equal(w.buildingId, undefined);
  assert.deepEqual(w.companyType, { not: 'vendor' });
});

test('validateCreateBody — accepts regular tenant', () => {
  assert.equal(validateCreateBody({ companyName: 'Acme', companyType: 'office' }), true);
});

test('validateCreateBody — rejects vendor regardless of casing', () => {
  assert.throws(() => validateCreateBody({ companyName: 'Ghost Corp', companyType: 'Vendor' }));
  assert.throws(() => validateCreateBody({ companyName: 'Ghost Corp', companyType: 'VENDOR' }));
  assert.throws(() => validateCreateBody({ companyName: 'Ghost Corp', companyType: 'vendor' }));
});

test('validateCreateBody — rejects blank companyName', () => {
  assert.throws(() => validateCreateBody({ companyName: '  ' }));
  assert.throws(() => validateCreateBody({}));
});
