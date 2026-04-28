// Static schema audit — every "template" and "tenant-owned operational" model
// MUST carry a non-nullable tenantId + have @@index([tenantId]) or equivalent.
// The multi-tenant isolation contract (INIT-001 Phase 4) holds only as long
// as every row-producing table is tenant-scoped by construction.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

function extractModel(name) {
  const re = new RegExp(`model ${name} \\{[\\s\\S]*?^\\}`, 'm');
  const m = schema.match(re);
  assert.ok(m, `model ${name} not found in schema.prisma`);
  return m[0];
}

function assertTenantScoped(modelName, { requireFk = true } = {}) {
  const body = extractModel(modelName);

  // Must have a tenantId column.
  const tenantLine = body.split('\n').find((l) => /^\s*tenantId\s+/.test(l));
  assert.ok(tenantLine, `${modelName} must declare a tenantId field`);

  // tenantId must be required (not String?).
  assert.ok(
    /tenantId\s+String\b/.test(tenantLine) && !/String\?/.test(tenantLine),
    `${modelName}.tenantId must be a required String (no '?'), got: ${tenantLine.trim()}`,
  );

  // Most tables must @relation back to Tenant (cascade-on-delete integrity).
  // Append-only event logs can opt out — they're single-tenant-only via RLS
  // and keeping them FK-free lets the audit survive tenant soft-deletes.
  if (requireFk) {
    assert.ok(
      /tenant\s+Tenant\s+@relation/.test(body) ||
        /Tenant\s+@relation\(fields: \[tenantId\]/.test(body),
      `${modelName} must @relation back to Tenant`,
    );
  }
}

test('PpmTemplate is tenant-scoped (non-nullable tenantId + FK to Tenant)', () => {
  assertTenantScoped('PpmTemplate');
});

test('ObligationTemplate is tenant-scoped', () => {
  assertTenantScoped('ObligationTemplate');
});

test('PpmPlanItem is tenant-scoped', () => {
  assertTenantScoped('PpmPlanItem');
});

test('BuildingObligation is tenant-scoped', () => {
  assertTenantScoped('BuildingObligation');
});

test('PpmExecutionLog is tenant-scoped (append-only event log — FK optional)', () => {
  assertTenantScoped('PpmExecutionLog', { requireFk: false });
});

test('No model named "GlobalPpmTemplate" or "SharedPpmTemplate" exists', () => {
  // The architecture decision is: template catalog is seeded INTO each tenant.
  // A global catalog table that any tenant could read/write would break isolation.
  assert.doesNotMatch(
    schema,
    /model (Global|Shared)(Ppm|Obligation)Template/,
    'A global/shared template model would violate tenant isolation — use per-tenant seed copies instead',
  );
});

test('Every tenant-scoped PPM model has @@index([tenantId]) for query performance', () => {
  for (const name of ['PpmTemplate', 'ObligationTemplate', 'PpmPlanItem']) {
    const body = extractModel(name);
    assert.match(
      body,
      /@@index\(\[tenantId[^\]]*\]\)|@@unique\(\[tenantId[^\]]*\]\)/,
      `${name} must have @@index or @@unique covering tenantId as first key`,
    );
  }
});
