// Unit tests for apps/api/src/common/building.helpers.ts
// Uses node:test (no Jest install needed) and stubs PrismaService.
// Run: node --test apps/api/test/building.helpers.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

// Import the TS helpers via tsx loader (auto-compiles on the fly).
// Node 22+ supports --experimental-strip-types; fall back to ts-node when
// unavailable. The test loader entry is set in the npm script.
const { requireManager, resolveBuildingId } = await import('../src/common/building.helpers.ts');

function makePrismaStub({
  membership = null,
  buildingRole = null,
  byId = null,
  bySlug = null,
} = {}) {
  return {
    membership: {
      findFirst: async () => membership,
    },
    buildingRoleAssignment: {
      findFirst: async () => buildingRole,
    },
    building: {
      findFirst: async () => byId,
      findUnique: async () => bySlug,
    },
  };
}

test('requireManager — workspace owner passes', async () => {
  const prisma = makePrismaStub({ membership: { id: 'm1' } });
  await assert.doesNotReject(() => requireManager(prisma, 't1', 'u1'));
});

test('requireManager — building_manager without workspace role passes', async () => {
  const prisma = makePrismaStub({ membership: null, buildingRole: { id: 'br1' } });
  await assert.doesNotReject(() => requireManager(prisma, 't1', 'u1'));
});

test('requireManager — no roles throws ForbiddenException', async () => {
  const prisma = makePrismaStub({ membership: null, buildingRole: null });
  await assert.rejects(
    () => requireManager(prisma, 't1', 'u1'),
    (err) => err.name === 'ForbiddenException' || /not authorized/.test(err.message),
  );
});

test('requireManager — extraBuildingRoles are honoured', async () => {
  let receivedRoles;
  const prisma = {
    membership: { findFirst: async () => null },
    buildingRoleAssignment: {
      findFirst: async (q) => {
        receivedRoles = q.where.roleKey.in;
        return { id: 'br1' };
      },
    },
    building: { findFirst: async () => null, findUnique: async () => null },
  };
  await requireManager(prisma, 't1', 'u1', { extraBuildingRoles: ['cleaning_supervisor'] });
  assert.ok(receivedRoles.includes('cleaning_supervisor'), 'extra role should be included');
  assert.ok(receivedRoles.includes('building_manager'), 'default roles should be preserved');
});

test('resolveBuildingId — returns id when found by id', async () => {
  const prisma = makePrismaStub({ byId: { id: 'b1' } });
  const id = await resolveBuildingId(prisma, 't1', 'b1');
  assert.equal(id, 'b1');
});

test('resolveBuildingId — falls back to slug lookup', async () => {
  const prisma = makePrismaStub({ byId: null, bySlug: { id: 'b2' } });
  const id = await resolveBuildingId(prisma, 't1', 'menivim-kfar-saba');
  assert.equal(id, 'b2');
});

test('resolveBuildingId — throws NotFoundException when missing', async () => {
  const prisma = makePrismaStub({ byId: null, bySlug: null });
  await assert.rejects(
    () => resolveBuildingId(prisma, 't1', 'ghost'),
    (err) => err.name === 'NotFoundException' || /not found/.test(err.message),
  );
});
