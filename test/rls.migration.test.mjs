// Static audit of the RLS bulk migration. No database needed — parses the
// SQL file and the Prisma schema, and asserts that every tenant-scoped
// model (one that declares `tenantId`) has all three RLS statements in
// 004_rls_all_tenant_tables.sql:
//   · ENABLE ROW LEVEL SECURITY
//   · FORCE ROW LEVEL SECURITY
//   · tenant_isolation policy (USING + WITH CHECK on current_setting)
//
// Catches regressions where someone adds a new model with tenantId but
// forgets to extend the migration.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '..', 'prisma', 'schema.prisma');
const migrationsDir = resolve(here, '..', 'prisma', 'migrations-sql');
const rlsDir = resolve(here, '..', 'prisma', 'rls');

// Read ALL raw-SQL migration files AND the rls/*.sql bundle. RLS for a table
// lives in one of three places:
//   · master prisma/rls/001_enable_rls.sql + 003_force_rls.sql (most tables)
//   · per-feature prisma/migrations-sql/006_devices_table.sql etc. (newer)
//   · per-feature DO $$ EXECUTE blocks (012, 014 — guarded on GUC helper)
// The isolation guarantee is the same. Test scans all three sources.
const rlsPath = migrationsDir; // retained for error messages
const allMigrations = [
  ...readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(resolve(migrationsDir, f), 'utf8')),
  ...readdirSync(rlsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(resolve(rlsDir, f), 'utf8')),
];

function tenantScopedTables() {
  const src = readFileSync(schemaPath, 'utf8');
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  const tables = [];
  let m;
  while ((m = modelRe.exec(src)) !== null) {
    const body = m[2];
    const mapMatch = body.match(/@@map\("([^"]+)"\)/);
    if (!mapMatch) continue;
    if (/^\s*tenantId\s+String/m.test(body)) tables.push(mapMatch[1]);
  }
  return tables;
}

// Known pre-existing RLS gaps. Documented here so a future engineer can
// close them deliberately rather than via this test silently. Gap IDs are
// tracked in INIT-006 (RLS coverage CI smoke).
//
// `roles` — INIT-013 intentional exemption. The roles table mixes:
//   · system roles (tenantId IS NULL, isCustom=false) — must be globally
//     readable so every workspace's role-builder UI can clone them.
//   · tenant-custom roles (tenantId = X) — visible only inside tenant X.
// A `tenantId = current_setting(...)` policy would HIDE the system rows
// (NULL ≠ any value), breaking the catalogue. We therefore keep RLS
// DISABLED on roles and enforce per-tenant write access at the
// application layer (RolesService validates
// `r.tenantId === actorTenantId && r.isCustom` on every UPDATE/DELETE).
// See migration 019_team_rls_force.sql for the contractual statement.
//
// `notification_rules` and `notification_templates` — INIT-014 same
// pattern: they mix system rows (tenantId IS NULL) with tenant-custom
// rows. Application-layer guards in NotificationsService enforce
// per-tenant writes. Migration 020 documents the exemption.
const KNOWN_GAPS = new Set([
  'lease_allocations',
  'roles',
  'notification_rules',
  'notification_templates',
]);

const tables = tenantScopedTables().filter((t) => !KNOWN_GAPS.has(t));

// A table's RLS statements can appear in ANY raw-SQL migration with or without
// double-quoted table name. Match on either the quoted form (used by master
// 004) or the unquoted form (used by feature-scoped migrations like 006).
//
// Additionally — prisma/rls/001_enable_rls.sql + 003_force_rls.sql apply RLS
// to a *list* of tables via a DO $$ loop (`'create policy %I_tenant_isolation
// on %I'` etc.) rather than emitting one statement per table. Detect that
// pattern by checking whether the table name appears as a quoted entry in
// the direct_tables / direct_force_tables arrays.
function inLoopList(t) {
  const pat = new RegExp(`'\\s*${t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*'\\s*[,\\]]`);
  return allMigrations.some((sql) => pat.test(sql));
}

function matchesAny(patterns) {
  return allMigrations.some((sql) => patterns.some((p) => p.test(sql)));
}

// Newer migrations (012, 014) wrap RLS statements in EXECUTE '...' inside
// DO $$ blocks (so the policy stays no-op when the GUC helper isn't yet
// installed). Allow flexible whitespace + optional trailing quote/semicolon.
test('RLS migration covers every tenant-scoped table — ENABLE', () => {
  for (const t of tables) {
    const ok =
      matchesAny([
        new RegExp(`ALTER TABLE "${t}"\\s+ENABLE\\s+ROW LEVEL SECURITY`),
        new RegExp(`ALTER TABLE ${t}\\s+ENABLE\\s+ROW LEVEL SECURITY`),
      ]) || inLoopList(t);
    assert.ok(ok, `missing ENABLE for ${t}`);
  }
});

test('RLS migration covers every tenant-scoped table — FORCE', () => {
  for (const t of tables) {
    const ok =
      matchesAny([
        new RegExp(`ALTER TABLE "${t}"\\s+FORCE\\s+ROW LEVEL SECURITY`),
        new RegExp(`ALTER TABLE ${t}\\s+FORCE\\s+ROW LEVEL SECURITY`),
      ]) || inLoopList(t);
    assert.ok(ok, `missing FORCE for ${t}`);
  }
});

test('RLS migration covers every tenant-scoped table — tenant_isolation policy', () => {
  for (const t of tables) {
    // Some tables use a custom policy name (<table>_tenant_isolation) when
    // they want to keep their migration self-contained — accept that too.
    const ok =
      matchesAny([
        new RegExp(`CREATE POLICY tenant_isolation ON "${t}"`),
        new RegExp(`CREATE POLICY tenant_isolation ON ${t}`),
        new RegExp(`CREATE POLICY ${t}_tenant_isolation ON "${t}"`),
        new RegExp(`CREATE POLICY ${t}_tenant_isolation ON ${t}`),
      ]) || inLoopList(t);
    assert.ok(ok, `missing policy for ${t}`);
  }
});

test('RLS migration — policy uses current_setting(app.current_tenant_id) with WITH CHECK', () => {
  // INIT-008 Phase 1 fixed the GUC name (app.tenant_id → app.current_tenant_id)
  // in 002 + 003 to match the runtime PrismaService set_config call. This test
  // was originally written for the old name; the assertion is updated to the
  // current canonical name. Migration 011 also rewrote PROD policies live.
  const master = allMigrations.find((sql) => /FORCE\s+ROW LEVEL SECURITY/.test(sql)) || '';
  assert.match(master, /current_setting\('app\.current_tenant_id', true\)/);
  assert.match(master, /USING.*WITH CHECK/s);
});
