// INIT-004 Phase 2 — AssignmentResolver branch coverage.
// Run: `node --test apps/api/test/assignment-resolver.test.mjs`
//
// Covers all four resolver outcomes:
//   1. floor.primary
//   2. floor.any (primary unavailable, secondary picked)
//   3. building.role (no floor assignment, building-wide fallback)
//   4. manager_queue (nobody eligible)

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveAssignment } from '../dist/modules/assignment/assignment.resolver.js';

const TENANT = 't1';
const BUILDING = 'b1';
const FLOOR = 'f1';

function fakePrisma({ floor = [], role = [], unavailable = [] } = {}) {
  return {
    floorAssignment: { findMany: async () => floor },
    buildingRoleAssignment: { findMany: async () => role },
    userAvailability: {
      findMany: async ({ where }) => {
        const ids = new Set(where.userId.in);
        return unavailable
          .filter((u) => ids.has(u.userId))
          .map((u) => ({ userId: u.userId, status: u.status }));
      },
    },
  };
}

test('floor.primary — primary on floor wins over secondary and fallback', async () => {
  const out = await resolveAssignment(
    fakePrisma({
      floor: [
        { userId: 'u-prim', primary: true },
        { userId: 'u-sec', primary: false },
      ],
      role: [{ userId: 'u-fall', delegatedAt: new Date() }],
    }),
    { tenantId: TENANT, buildingId: BUILDING, floorId: FLOOR, roleKey: 'technician' },
  );
  assert.equal(out.userId, 'u-prim');
  assert.equal(out.source, 'floor.primary');
});

test('floor.any — primary off today, secondary picked', async () => {
  const out = await resolveAssignment(
    fakePrisma({
      floor: [
        { userId: 'u-prim', primary: true },
        { userId: 'u-sec', primary: false },
      ],
      unavailable: [{ userId: 'u-prim', status: 'sick' }],
    }),
    { tenantId: TENANT, buildingId: BUILDING, floorId: FLOOR, roleKey: 'technician' },
  );
  assert.equal(out.userId, 'u-sec');
  assert.equal(out.source, 'floor.any');
});

test('building.role — no floor assignments, falls back to anyone with role', async () => {
  const out = await resolveAssignment(
    fakePrisma({
      role: [
        { userId: 'u-old', delegatedAt: new Date('2025-01-01') },
        { userId: 'u-new', delegatedAt: new Date('2025-06-01') },
      ],
    }),
    { tenantId: TENANT, buildingId: BUILDING, floorId: FLOOR, roleKey: 'technician' },
  );
  assert.equal(out.userId, 'u-old');
  assert.equal(out.source, 'building.role');
});

test('building.role — fallback skips off-today users', async () => {
  const out = await resolveAssignment(
    fakePrisma({
      role: [
        { userId: 'u-old', delegatedAt: new Date('2025-01-01') },
        { userId: 'u-new', delegatedAt: new Date('2025-06-01') },
      ],
      unavailable: [{ userId: 'u-old', status: 'leave' }],
    }),
    { tenantId: TENANT, buildingId: BUILDING, floorId: FLOOR, roleKey: 'technician' },
  );
  assert.equal(out.userId, 'u-new');
  assert.equal(out.source, 'building.role');
});

test('manager_queue — nobody available anywhere', async () => {
  const out = await resolveAssignment(
    fakePrisma({
      floor: [{ userId: 'u-prim', primary: true }],
      role: [{ userId: 'u-prim', delegatedAt: new Date() }],
      unavailable: [{ userId: 'u-prim', status: 'off' }],
    }),
    { tenantId: TENANT, buildingId: BUILDING, floorId: FLOOR, roleKey: 'technician' },
  );
  assert.equal(out.userId, null);
  assert.equal(out.source, 'manager_queue');
});

test('floorId omitted — runs only the building.role step', async () => {
  const out = await resolveAssignment(
    fakePrisma({
      role: [{ userId: 'u-1', delegatedAt: new Date() }],
    }),
    { tenantId: TENANT, buildingId: BUILDING, roleKey: 'technician' },
  );
  assert.equal(out.userId, 'u-1');
  assert.equal(out.source, 'building.role');
});

test('non-blocking statuses (e.g. available) do not remove a candidate', async () => {
  const out = await resolveAssignment(
    fakePrisma({
      floor: [{ userId: 'u-prim', primary: true }],
      unavailable: [{ userId: 'u-prim', status: 'available' }],
    }),
    { tenantId: TENANT, buildingId: BUILDING, floorId: FLOOR, roleKey: 'technician' },
  );
  assert.equal(out.userId, 'u-prim');
  assert.equal(out.source, 'floor.primary');
});
