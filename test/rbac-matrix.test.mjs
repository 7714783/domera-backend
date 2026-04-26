// INIT-007 Phase 7 — RBAC × ABAC authorization matrix smoke test.
//
// Loads test/rbac-matrix.json and runs each row through the policy
// engine's authorize() function. Each row is named — a CI failure
// reports exactly which role × permission × scope dimension drifted.
//
// This is the smaller-scope version of the planned rbac-matrix-smoke job:
// pure logic against the policy engine, no HTTP / DB. Bigger end-to-end
// version (bootstrap users + hit endpoints) lives as a follow-up. This
// version still catches every regression in policy.ts and any
// permission-list change in the seed that breaks a documented expectation.
//
// Run: `node --test apps/api/test/rbac-matrix.test.mjs`

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { authorize, AuthorizationError } from '../dist/common/authz/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const matrix = JSON.parse(readFileSync(join(here, 'rbac-matrix.json'), 'utf8'));

function buildActor(spec) {
  return {
    userId: spec.userId || 'u-test',
    activeRole: spec.role,
    permissions: new Set(spec.permissions || []),
    scope: {
      tenantId: spec.scope?.tenantId || 't1',
      buildingIds: spec.scope?.buildingIds,
      floorIds: spec.scope?.floorIds,
      zoneIds: spec.scope?.zoneIds,
      systemIds: spec.scope?.systemIds,
      contractorCompanyId: spec.scope?.contractorCompanyId,
      tenantCompanyId: spec.scope?.tenantCompanyId,
      teamId: spec.scope?.teamId,
      createdByScope: spec.scope?.createdByScope,
    },
    authzVersion: 1,
    mfaLevel: spec.mfaLevel || 'mfa',
    isSuperAdmin: !!spec.isSuperAdmin,
  };
}

for (const row of matrix.rows) {
  test(row.name, () => {
    const actor = buildActor(row.actor);
    const expected = row.expectedAccess;
    let actual = 'allow';
    let err = null;
    try {
      authorize(actor, row.permission, row.resource, row.options);
    } catch (e) {
      err = e;
      actual = e instanceof AuthorizationError ? e.reasonCode : `THREW:${e?.message}`;
    }
    if (expected === 'allow') {
      assert.equal(actual, 'allow', `expected allow but got ${actual} (${err?.message})`);
    } else {
      assert.ok(err instanceof AuthorizationError, `expected AuthorizationError, got: ${err}`);
      assert.equal(
        actual,
        expected,
        `wrong reason code — matrix says ${expected}, engine returned ${actual}`,
      );
    }
  });
}

test('matrix has at least 15 rows (cover all 6 scope dimensions)', () => {
  assert.ok(matrix.rows.length >= 15, `matrix too small: ${matrix.rows.length} rows`);
});
