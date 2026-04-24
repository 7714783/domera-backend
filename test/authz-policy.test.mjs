// INIT-007 Phase 3 — policy engine unit tests.
//
// Pure-JS tests against the compiled TS module. Run via `npm test` (add to
// the script list) or directly: `node apps/api/test/authz-policy.test.mjs`.
// No Prisma, no Nest — the policy engine is intentionally dependency-free.

import { strict as assert } from 'node:assert';
import { authorize, requirePermission, requireScope, scopeWhere } from '../dist/common/authz/policy.js';
import { AuthorizationError } from '../dist/common/authz/types.js';

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log('\u2713', name);
    pass++;
  } catch (e) {
    console.error('\u2717', name, '-', e?.message ?? e);
    fail++;
  }
}

function makeActor(overrides = {}) {
  return {
    userId: 'u-alpha',
    activeRole: 'technician',
    permissions: new Set(['tasks.view_assigned', 'building.read']),
    scope: {
      tenantId: 't-alpha',
      buildingIds: ['b-central'],
      floorIds: [],
      zoneIds: [],
      systemIds: [],
      teamId: null,
      contractorCompanyId: null,
      tenantCompanyId: null,
      createdByScope: false,
    },
    authzVersion: 1,
    mfaLevel: 'password',
    isSuperAdmin: false,
    ...overrides,
  };
}

function makeResource(overrides = {}) {
  return {
    tenantId: 't-alpha',
    buildingId: 'b-central',
    floorId: null,
    zoneId: null,
    systemId: null,
    contractorCompanyId: null,
    tenantCompanyId: null,
    teamId: null,
    assignedUserId: null,
    createdByUserId: null,
    ...overrides,
  };
}

function expectThrow(reasonCode, fn) {
  let caught = null;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof AuthorizationError, `expected AuthorizationError, got ${caught}`);
  assert.equal(caught.reasonCode, reasonCode);
}

// -------------------------------------------------- permission checks
test('requirePermission passes when actor has it', () => {
  const a = makeActor();
  requirePermission(a, 'tasks.view_assigned');
});

test('requirePermission throws MISSING_PERMISSION', () => {
  const a = makeActor();
  expectThrow('MISSING_PERMISSION', () => requirePermission(a, 'tasks.assign'));
});

test('super admin bypasses permission check', () => {
  const a = makeActor({ isSuperAdmin: true, permissions: new Set() });
  requirePermission(a, 'users.manage');
});

// -------------------------------------------------- scope checks
test('cross-tenant access blocked', () => {
  const a = makeActor();
  expectThrow('CROSS_TENANT_ACCESS', () =>
    requireScope(a, makeResource({ tenantId: 't-beta' })),
  );
});

test('same tenant building access passes', () => {
  const a = makeActor();
  requireScope(a, makeResource({ buildingId: 'b-central' }));
});

test('different building blocked when buildingIds populated', () => {
  const a = makeActor();
  expectThrow('BUILDING_SCOPE_VIOLATION', () =>
    requireScope(a, makeResource({ buildingId: 'b-other' })),
  );
});

test('empty buildingIds means unrestricted within tenant', () => {
  const a = makeActor({ scope: { ...makeActor().scope, buildingIds: [] } });
  requireScope(a, makeResource({ buildingId: 'b-anywhere' }));
});

test('floorIds narrows within building', () => {
  const a = makeActor({
    scope: { ...makeActor().scope, floorIds: ['f-4', 'f-5'] },
  });
  requireScope(a, makeResource({ floorId: 'f-4' }));
  expectThrow('FLOOR_SCOPE_VIOLATION', () =>
    requireScope(a, makeResource({ floorId: 'f-6' })),
  );
});

test('null floorId on resource is skipped (dimension absent)', () => {
  const a = makeActor({
    scope: { ...makeActor().scope, floorIds: ['f-4'] },
  });
  requireScope(a, makeResource({ floorId: null }));
});

test('contractor scope blocks other company', () => {
  const a = makeActor({
    scope: { ...makeActor().scope, contractorCompanyId: 'cco-spark' },
  });
  expectThrow('CONTRACTOR_SCOPE_VIOLATION', () =>
    requireScope(a, makeResource({ contractorCompanyId: 'cco-other' })),
  );
});

test('tenantCompany scope blocks other company', () => {
  const a = makeActor({
    scope: { ...makeActor().scope, tenantCompanyId: 'tco-a' },
  });
  expectThrow('TENANT_COMPANY_SCOPE_VIOLATION', () =>
    requireScope(a, makeResource({ tenantCompanyId: 'tco-b' })),
  );
});

test('team scope blocks other team', () => {
  const a = makeActor({ scope: { ...makeActor().scope, teamId: 'tech-hvac' } });
  expectThrow('TEAM_SCOPE_VIOLATION', () =>
    requireScope(a, makeResource({ teamId: 'tech-elec' })),
  );
});

test('createdByScope blocks foreign createdByUserId', () => {
  const a = makeActor({ scope: { ...makeActor().scope, createdByScope: true } });
  expectThrow('CREATED_BY_SCOPE_VIOLATION', () =>
    requireScope(a, makeResource({ createdByUserId: 'u-other' })),
  );
});

test('createdByScope allows own createdByUserId', () => {
  const a = makeActor({ scope: { ...makeActor().scope, createdByScope: true } });
  requireScope(a, makeResource({ createdByUserId: 'u-alpha' }));
});

// -------------------------------------------------- combined authorize
test('authorize requires both permission + scope', () => {
  const a = makeActor();
  authorize(a, 'tasks.view_assigned', makeResource());
  expectThrow('MISSING_PERMISSION', () =>
    authorize(a, 'tasks.assign', makeResource()),
  );
  expectThrow('CROSS_TENANT_ACCESS', () =>
    authorize(a, 'tasks.view_assigned', makeResource({ tenantId: 't-beta' })),
  );
});

test('authorize step-up MFA enforced when requireMfa set', () => {
  const a = makeActor({ mfaLevel: 'password' });
  expectThrow('STEP_UP_REQUIRED', () =>
    authorize(a, 'tasks.view_assigned', makeResource(), { requireMfa: true }),
  );
  const a2 = makeActor({ mfaLevel: 'mfa' });
  authorize(a2, 'tasks.view_assigned', makeResource(), { requireMfa: true });
});

// -------------------------------------------------- scopeWhere helper
test('scopeWhere returns tenant-only for unrestricted actor', () => {
  const where = scopeWhere(makeActor().scope);
  assert.deepEqual(where, { tenantId: 't-alpha', buildingId: { in: ['b-central'] } });
});

test('scopeWhere strips empty arrays', () => {
  const where = scopeWhere({ ...makeActor().scope, buildingIds: [], floorIds: [] });
  assert.deepEqual(where, { tenantId: 't-alpha' });
});

test('scopeWhere adds contractor/tenant-company filters', () => {
  const where = scopeWhere({
    ...makeActor().scope,
    contractorCompanyId: 'cco-1',
    tenantCompanyId: 'tco-1',
    teamId: 't-x',
  });
  assert.equal(where.contractorCompanyId, 'cco-1');
  assert.equal(where.tenantCompanyId, 'tco-1');
  assert.equal(where.teamId, 't-x');
});

// --------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
