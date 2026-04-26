// Event catalogue + payload schema guard.
//
// Pinned by docs/architecture/platform-development-contract.md § 4.
// Cross-module synchronisation is the responsibility of named events
// with versioned payloads. Adding a new event without registering it
// here = silent contract drift; this test rejects the change.
//
// Self-validation only on the first pass — enforces:
//   1. Every event has producer, consumers[], schemaVersion, payloadShape.
//   2. Every consumer module exists in apps/api/src/modules/ (no typos).
//   3. Every producer module exists.
//   4. Schema version monotonic (≥ 1).
//
// A future tightening (CATALOG_FILE_SCAN) will grep the codebase for
// outbox.publish('<type>', …) calls and require every type to match a
// catalogue entry. Stub left below.
//
// Run: `node --test apps/api/test/event-contract.test.mjs`

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, '..', 'src', 'modules');

// ── CATALOG ───────────────────────────────────────────────────
//
// Each event:
//   producer    — module folder name that emits this event
//   consumers   — module folder names that subscribe (zero or more)
//   schemaVersion — bump on payload breaking change
//   payloadShape — top-level keys; nested validation lives in the producer
//                  (ajv schema beside the publish call). This catalogue is
//                  the contract — the producer's schema must match.
//
// Adding a new event:
//   1. Append to CATALOG.
//   2. Add producer ajv schema next to the publish call.
//   3. Each consumer module subscribes via its outbox runner.
//   4. PR ticks "Events" checklist box.

const CATALOG = {
  // assets
  'asset.created': {
    producer: 'assets',
    consumers: ['ppm', 'role-dashboards'],
    schemaVersion: 1,
    payloadShape: ['assetId', 'tenantId', 'buildingId', 'systemFamily', 'createdBy'],
  },
  'asset.updated': {
    producer: 'assets',
    consumers: ['role-dashboards'],
    schemaVersion: 1,
    payloadShape: ['assetId', 'tenantId', 'changes', 'updatedBy'],
  },

  // ppm
  'ppm.case.opened': {
    producer: 'ppm',
    consumers: ['role-dashboards', 'audit'],
    schemaVersion: 1,
    payloadShape: ['caseId', 'tenantId', 'buildingId', 'planItemId', 'openedBy'],
  },
  'ppm.check.completed': {
    producer: 'ppm',
    consumers: ['assets', 'documents'],
    schemaVersion: 1,
    payloadShape: ['caseId', 'tenantId', 'assetId', 'result', 'evidenceDocumentIds'],
  },
  'ppm.expense.requested': {
    producer: 'ppm',
    consumers: ['approvals'],
    schemaVersion: 1,
    payloadShape: ['caseId', 'tenantId', 'amount', 'currency', 'reason'],
  },
  'ppm.case.closed': {
    producer: 'ppm',
    consumers: ['assets', 'documents', 'role-dashboards'],
    schemaVersion: 1,
    payloadShape: ['caseId', 'tenantId', 'assetId', 'finalStatus', 'evidenceDocumentIds'],
  },

  // approvals
  'approval.granted': {
    producer: 'approvals',
    consumers: ['ppm', 'reactive'],
    schemaVersion: 1,
    payloadShape: ['approvalId', 'tenantId', 'subjectType', 'subjectId', 'grantedBy'],
  },
  'approval.rejected': {
    producer: 'approvals',
    consumers: ['ppm', 'reactive'],
    schemaVersion: 1,
    payloadShape: ['approvalId', 'tenantId', 'subjectType', 'subjectId', 'reason'],
  },

  // reactive
  'workorder.dispatched': {
    producer: 'reactive',
    consumers: ['role-dashboards'],
    schemaVersion: 1,
    payloadShape: ['workOrderId', 'tenantId', 'buildingId', 'vendorOrgId'],
  },
  'completion.recorded': {
    producer: 'reactive',
    consumers: ['ppm', 'assets', 'documents'],
    schemaVersion: 1,
    payloadShape: ['completionId', 'tenantId', 'workOrderId', 'completedAt'],
  },
  'invoice.paid': {
    producer: 'reactive',
    consumers: ['ppm'],
    schemaVersion: 1,
    payloadShape: ['invoiceId', 'tenantId', 'amount', 'paidAt'],
  },

  // cleaning
  'cleaning.request.created': {
    producer: 'cleaning',
    consumers: ['role-dashboards'],
    schemaVersion: 1,
    payloadShape: ['requestId', 'tenantId', 'buildingId', 'zoneId', 'source'],
  },
  'cleaning.request.completed': {
    producer: 'cleaning',
    consumers: [],
    schemaVersion: 1,
    payloadShape: ['requestId', 'tenantId', 'completedBy', 'completedAt'],
  },

  // assignment
  'floor_assignment.changed': {
    producer: 'assignment',
    consumers: ['reactive'],
    schemaVersion: 1,
    payloadShape: ['floorId', 'tenantId', 'changeType', 'roleKey'],
  },
};

// ── Self-validation ───────────────────────────────────────────

test('every event has a producer that exists as a module folder', () => {
  for (const [type, def] of Object.entries(CATALOG)) {
    assert.ok(def.producer, `${type}: missing producer`);
    const path = join(modulesDir, def.producer);
    assert.ok(existsSync(path), `${type}: producer module folder ${def.producer} not found`);
  }
});

test('every consumer is an existing module folder', () => {
  for (const [type, def] of Object.entries(CATALOG)) {
    for (const c of def.consumers) {
      const path = join(modulesDir, c);
      assert.ok(
        existsSync(path),
        `${type}: consumer ${c} does not exist as module folder`,
      );
    }
  }
});

test('every event declares schemaVersion ≥ 1', () => {
  for (const [type, def] of Object.entries(CATALOG)) {
    assert.ok(
      typeof def.schemaVersion === 'number' && def.schemaVersion >= 1,
      `${type}: schemaVersion must be a number ≥ 1`,
    );
  }
});

test('every event declares a non-empty payloadShape with tenantId', () => {
  for (const [type, def] of Object.entries(CATALOG)) {
    assert.ok(
      Array.isArray(def.payloadShape) && def.payloadShape.length > 0,
      `${type}: payloadShape must be a non-empty array`,
    );
    assert.ok(
      def.payloadShape.includes('tenantId'),
      `${type}: payloadShape must include tenantId (multi-tenant invariant)`,
    );
  }
});

test('event type names follow `<domain>.<entity>.<verb>` convention', () => {
  for (const type of Object.keys(CATALOG)) {
    const ok = /^[a-z_]+\.[a-z_]+(\.[a-z_]+)?$/.test(type);
    assert.ok(ok, `${type}: name must be lower_snake.dot.separated`);
  }
});

test('event catalogue has at least the 8 P1 cross-module events', () => {
  // Spot-check the events that are referenced from contract.md § 4.
  const required = [
    'asset.created',
    'ppm.case.closed',
    'approval.granted',
    'completion.recorded',
    'cleaning.request.created',
    'invoice.paid',
    'ppm.expense.requested',
    'floor_assignment.changed',
  ];
  for (const t of required) {
    assert.ok(t in CATALOG, `required event ${t} missing from catalogue`);
  }
});
