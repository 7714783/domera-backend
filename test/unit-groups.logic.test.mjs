// Unit tests for BuildingUnitGroup validation rules.
// Mirrors logic in apps/api/src/modules/building-core/building-core.service.ts
// (createUnitGroup / updateUnitGroup).

import test from 'node:test';
import assert from 'node:assert/strict';

function validateCreateBody(body) {
  if (!body.groupCode?.trim() || !body.name?.trim()) throw new Error('groupCode and name required');
  if (!Array.isArray(body.unitIds) || body.unitIds.length < 2) {
    throw new Error('at least two unitIds required to form a group');
  }
  return {
    groupCode: body.groupCode.trim(),
    name: body.name.trim(),
    unitIds: Array.from(new Set(body.unitIds)),
  };
}

function partitionUnits(units) {
  const alreadyGrouped = units.filter((u) => u.groupId);
  const free = units.filter((u) => !u.groupId);
  return { alreadyGrouped, free };
}

test('createUnitGroup — rejects single-unit group', () => {
  assert.throws(() => validateCreateBody({ groupCode: '3F-A', name: 'Acme', unitIds: ['u1'] }));
});

test('createUnitGroup — accepts 2+ unique unit ids', () => {
  const out = validateCreateBody({ groupCode: '3F-A', name: 'Acme', unitIds: ['u1', 'u2'] });
  assert.deepEqual(out.unitIds, ['u1', 'u2']);
});

test('createUnitGroup — dedupes duplicate unit ids', () => {
  const out = validateCreateBody({ groupCode: 'X', name: 'Y', unitIds: ['u1', 'u1', 'u2'] });
  assert.deepEqual(out.unitIds.sort(), ['u1', 'u2']);
});

test('createUnitGroup — trims whitespace', () => {
  const out = validateCreateBody({
    groupCode: '  3F-A  ',
    name: '  Acme  ',
    unitIds: ['u1', 'u2'],
  });
  assert.equal(out.groupCode, '3F-A');
  assert.equal(out.name, 'Acme');
});

test('createUnitGroup — rejects blank code/name', () => {
  assert.throws(() => validateCreateBody({ groupCode: '', name: 'X', unitIds: ['u1', 'u2'] }));
  assert.throws(() => validateCreateBody({ groupCode: 'X', name: '  ', unitIds: ['u1', 'u2'] }));
});

test('partitionUnits — separates grouped vs free units', () => {
  const units = [
    { id: 'u1', groupId: null, unitCode: 'U1' },
    { id: 'u2', groupId: 'g1', unitCode: 'U2' },
    { id: 'u3', groupId: null, unitCode: 'U3' },
  ];
  const { alreadyGrouped, free } = partitionUnits(units);
  assert.equal(alreadyGrouped.length, 1);
  assert.equal(free.length, 2);
  assert.equal(alreadyGrouped[0].unitCode, 'U2');
});
