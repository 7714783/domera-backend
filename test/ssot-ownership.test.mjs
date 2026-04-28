// SSOT ownership guard.
//
// Each entity in docs/architecture/entity-ownership-ssot.md has exactly one
// owning module that may write it. This test greps every controller +
// service file for `prisma.<delegate>.(create|update|upsert|delete|deleteMany|updateMany)`
// and asserts the call sits under the owning module's directory.
//
// When the audit catches a violation it points at the exact file:line so
// the engineer either (a) moves the call to the owner, (b) explicitly
// adds the model to OWNERSHIP after a deliberate ownership change.
//
// Run: `node --test apps/api/test/ssot-ownership.test.mjs`

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, '..', 'src', 'modules');

// delegate (camelCase prisma client property) → owning module folder name.
// Modules that aren't listed here are ignored — add them as new entities
// land in the schema. Read-only consumers don't appear here.
const OWNERSHIP = {
  // ── building-core (structural model only — floors, units, systems) ──
  buildingFloor: 'building-core',
  buildingUnit: 'building-core',
  buildingSystem: 'building-core',
  buildingVerticalTransport: 'building-core',
  elevatorProfile: 'building-core',
  // BuildingOccupantCompany — occupants creates/updates; tenant-companies
  // sets adminUserId; building-core has a legacy create path
  // (POST /buildings/:id/occupants) inherited from INIT-001 that
  // overlaps with /v1/occupants. Tracked as a consolidation follow-up
  // (see entity-ownership-ssot.md "ambiguous"); kept here for now so the
  // test reflects reality rather than aspiration.
  buildingOccupantCompany: ['occupants', 'tenant-companies', 'building-core'],
  buildingUnitOccupancy: ['building-core', 'occupants'],
  // BuildingContract is the lease/contract record — leases owns its
  // lifecycle (status transitions, terminations).
  buildingContract: ['building-core', 'leases'],
  // ── assets ────────────────────────────────────────────────────────
  asset: 'assets',
  assetType: 'assets',
  assetCustomAttribute: 'assets',
  assetDocument: 'assets',
  assetMedia: 'assets',
  assetSparePart: 'assets',
  // ── assignment (INIT-004) ────────────────────────────────────────
  floorAssignment: 'assignment',
  userAvailability: 'assignment',
  // ── contractor-companies (INIT-007 P6) ────────────────────────────
  contractorCompany: 'contractor-companies',
  // ── ppm ───────────────────────────────────────────────────────────
  // INIT-010 P0-1 (2026-04-26): TaskInstance — canonical owner ppm
  // (creates from PPM plan items + condition-triggers via DI).
  // tasks updates lifecycle state (start/pause/resume/complete) from the
  // user-facing /v1/tasks/:id/* endpoints — that's the legitimate state
  // machine operator, separate from creation.
  // seed-runtime is the dev-only demo harness — accepted exception.
  taskInstance: ['ppm', 'tasks', 'seed-runtime'],

  // ── reactive ──────────────────────────────────────────────────────
  // Connectors creates incidents from inbound webhooks (legitimate
  // external integration path); public-qr creates service-requests
  // from anonymous QR scans.
  incident: ['reactive', 'connectors'],
  serviceRequest: ['reactive', 'public-qr'],
  workOrder: 'reactive',
  quote: 'reactive',
  purchaseOrder: 'reactive',
  // CompletionRecord can be created by PPM (auto-close on task complete)
  // and by imports (bulk historic data migration), in addition to reactive.
  completionRecord: ['reactive', 'ppm', 'imports'],
  // ── cleaning ──────────────────────────────────────────────────────
  cleaningRequest: 'cleaning',
  cleaningRequestComment: 'cleaning',
  cleaningRequestHistory: 'cleaning',
  cleaningRequestAttachment: 'cleaning',
  cleaningZone: 'cleaning',
  cleaningContractor: 'cleaning',
  cleaningStaff: 'cleaning',
  cleaningRole: 'cleaning',
  // ── audit ─────────────────────────────────────────────────────────
  // Every module writes via audit.write() — only the audit service
  // should touch prisma.auditEntry directly.
  auditEntry: 'audit',
  // ── INIT-013 Roles & Team module ──────────────────────────────────
  // Public registry — only contractors-public writes. Workspace_owner
  // creating a new contractor goes through that module's service.
  publicContractor: 'contractors-public',
  // Workspace ↔ contractor link table. Owned by contractors-workspace.
  workspaceContractor: 'contractors-workspace',
  // TeamMember is the workspace-wide people catalogue. Owner: team.
  // iam keeps a legacy create path (createStaff) during migration —
  // acceptable transitional dual-write.
  teamMember: ['team', 'iam'],
  // Role grants — owner: role-assignments. iam.service legacy revoke
  // path remains during migration.
  teamMemberRoleAssignment: ['role-assignments', 'team', 'iam'],
  // ── INIT-014 Unified Notifications + Mailer ───────────────────────
  // The notifications module is sole owner of every delivery row + rule
  // + template + preference + inbound event + suppression. Domain
  // modules NEVER write here — they publish events; the subscriber
  // creates deliveries.
  // Legacy `notifications` (in-app inbox) — owner: notifications.
  // Transitional: ppm.sla-reminder.worker writes legacy in-app rows
  // directly until INIT-014 phase 2 routes SLA reminders through the
  // notifications dispatcher.
  notification: ['notifications', 'ppm'],
  notificationRule: 'notifications',
  notificationTemplate: 'notifications',
  notificationDelivery: 'notifications',
  notificationPreference: 'notifications',
  emailInboundEvent: 'notifications',
  emailSuppression: 'notifications',
};

const WRITE_OPS = ['create', 'update', 'upsert', 'delete', 'deleteMany', 'updateMany', 'createMany'];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = walk(modulesDir);

const violations = [];
for (const file of files) {
  const rel = relative(modulesDir, file).replace(/\\/g, '/');
  const moduleName = rel.split('/')[0];
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip single-line comments — they often DESCRIBE prisma calls that
    // were removed (see condition-triggers.service.ts header explaining the
    // P0-1 fix). Without this, the test fires on docstrings.
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const [delegate, allowed] of Object.entries(OWNERSHIP)) {
      const allowedList = Array.isArray(allowed) ? allowed : [allowed];
      const re = new RegExp(`\\bprisma\\.${delegate}\\.(${WRITE_OPS.join('|')})\\b`);
      if (re.test(line) && !allowedList.includes(moduleName)) {
        violations.push({
          file: rel,
          line: i + 1,
          delegate,
          op: line.match(re)?.[1],
          owner: allowedList.join(' or '),
          actor: moduleName,
          snippet: line.trim().slice(0, 140),
        });
      }
    }
  }
}

test('SSOT ownership — no cross-module writes to canonical entities', () => {
  if (violations.length > 0) {
    const report = violations
      .map(
        (v) =>
          `  · ${v.file}:${v.line}  prisma.${v.delegate}.${v.op}()` +
          `\n    owner=${v.owner}  actor=${v.actor}` +
          `\n    ${v.snippet}`,
      )
      .join('\n');
    assert.fail(
      `${violations.length} cross-module write(s) to owned entities:\n${report}\n\n` +
        `See docs/architecture/entity-ownership-ssot.md. Either move the write to the ` +
        `owner module, or update the OWNERSHIP map in this test if the entity ` +
        `genuinely changed owners.`,
    );
  }
});
