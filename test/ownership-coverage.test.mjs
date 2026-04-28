// Ownership coverage guard.
//
// Pinned by docs/architecture/platform-development-contract.md § 3 +
// docs/architecture/legacy-architecture-audit-2026-04-26.md P0-2.
//
// The point: every Prisma delegate either has an owning module declared in
// ssot-ownership.test.mjs OWNERSHIP, OR is on this file's EXEMPT list with
// a one-line reason. CI green by omission was the root risk found in the
// INIT-010 audit — this test removes that risk for good.
//
// Adding a new Prisma model = either:
//   (a) add to ssot-ownership OWNERSHIP map (real owner), or
//   (b) add to EXEMPT below with a written justification.
//
// No silent third option. Run: `node --test apps/api/test/ownership-coverage.test.mjs`.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'prisma', 'schema.prisma');
const ssotPath = join(here, 'ssot-ownership.test.mjs');

// Convert "ModelName" → "modelName" — Prisma's delegate naming convention.
function toDelegate(modelName) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

function listModels() {
  const src = readFileSync(schemaPath, 'utf8');
  return [...src.matchAll(/^model\s+([A-Z][A-Za-z0-9_]*)\s*\{/gm)].map((m) => toDelegate(m[1]));
}

function listOwnershipKeys() {
  const src = readFileSync(ssotPath, 'utf8');
  // Match every key inside the OWNERSHIP literal — keys are unquoted JS identifiers.
  // We narrow by extracting the OWNERSHIP block first.
  const block = src.match(/const OWNERSHIP = \{([\s\S]*?)\n\};/);
  if (!block) return new Set();
  const keys = new Set();
  for (const m of block[1].matchAll(/^\s*([a-zA-Z][A-Za-z0-9_]*)\s*:/gm)) {
    keys.add(m[1]);
  }
  return keys;
}

// EXEMPT — every delegate listed here MUST have a one-line reason next to it.
// Keep alphabetised. New entries require @architecture review (CODEOWNERS).
//
// Five categories of legitimate exemption:
//   - reference data seeded from JSON (Role, RolePermission, Certification)
//   - system/service tables written from many places (Session, AuditEntry — the
//     latter has its own owner row, listed there)
//   - read-only projections (none yet)
//   - DEPRECATED legacy models (Floor, Unit) — no writers remain
//   - join tables with ambient ownership (e.g. UserCertification edited
//     wherever certifications change)
const EXEMPT = {
  // Reference / seed-driven
  role: 'seeded by prisma/seeds/seed-reference.mjs (no module owns it at runtime)',
  rolePermission: 'seeded by prisma/seeds/seed-reference.mjs',
  certification: 'seeded by prisma/seeds/seed-reference.mjs',
  documentType: 'seeded by prisma/seeds/seed-reference.mjs',
  applicabilityRule: 'seeded — applicability rules for obligations',
  obligationBasis: 'seeded — obligation basis catalogue',
  seedRun: 'written by prisma/seeds/* runners only',

  // Auth / session — tightly bound to auth module but outside the SSOT contract surface
  session: 'written by auth.service on login/logout — auth module owner by convention',
  oidcLoginState: 'written by sso module during OIDC handshake',
  scimToken: 'written by scim module',
  federatedIdentity: 'written by sso module',
  signedUrl: 'written by documents module for time-limited download links',
  userMfa: 'written by mfa module',
  userCertification: 'written by iam.staff.controller when staff cert is added/updated',

  // Outbox / webhook plumbing — infrastructure, owned by event-emitting modules
  outboxEvent: 'written by every module that emits events; consumed by webhooks worker',
  inboundWebhookSource: 'written by webhooks module',
  inboundWebhookEvent: 'written by webhooks module on inbound POST',
  webhookSubscription: 'written by webhooks module',

  // DEPRECATED — pre-INIT-001 legacy. No writers remain. Tables stay until cleanup migration drops them.
  floor: 'DEPRECATED — replaced by buildingFloor (see schema comment 2026-04-26)',
  unit: 'DEPRECATED — replaced by buildingUnit',

  // Tenant root + user — cross-cutting, not owned by a single domain module
  tenant: 'written by onboarding.bootstrap; root identity record',
  user: 'written by auth.register + iam.createStaff — multi-owner by design',
  membership: 'written by onboarding + iam',
  organization: 'written by organizations module + onboarding',
  organizationMembership: 'written by iam.createStaff',
  buildingRoleAssignment: 'written by iam (assign / revoke) + tenant-companies (admin promotion)',
  building: 'written by buildings + onboarding modules — split by lifecycle stage',
  buildingSettings: 'written by buildings module',
  buildingMandate: 'written by organizations module',

  // PPM internals — ppm owns the family
  ppmTemplate: 'written by ppm module + seed-ppm-programs.mjs',
  ppmPlanItem: 'written by ppm module',
  ppmExecutionLog: 'written by ppm module',
  // taskInstance moved to OWNERSHIP map (sole owner: ppm) after INIT-010 P0-1 fix
  taskNote: 'written by tasks module',
  maintenancePlan: 'legacy — replaced by ppmPlanItem; no active writers',

  // Reactive family — owned by reactive module
  // (incident, serviceRequest, workOrder, quote, purchaseOrder, completionRecord
  //  are already in OWNERSHIP)

  // Building inventory family
  parkingSpot: 'written by building-core module',
  storageUnit: 'written by building-core module',
  entrance: 'written by building-core module',
  equipmentRelation: 'written by building-core module',

  // Compliance + obligations
  complianceProfile: 'written by compliance-profiles module + seed',
  buildingComplianceProfile: 'written by compliance-profiles module',
  obligationTemplate: 'written by obligations module + seed',
  buildingObligation: 'written by obligations module',
  calendarBlackout: 'written by calendar-blackouts module + seed',
  conditionTrigger: 'written by condition-triggers module',
  conditionEvent: 'written by condition-triggers module',
  emergencyOverride: 'written by emergency-overrides module',
  engineeringRecommendation: 'written by takeover module',
  takeoverCase: 'written by takeover module',

  // Documents family — documents module owns
  document: 'written by documents module + auto-link from completion path',
  documentLink: 'written by document-links module + reactive (on completion)',
  documentTemplate: 'written by document-templates module',

  // Inventory family — inventory module owns
  inventoryItem: 'written by inventory module',
  stockLocation: 'written by inventory module',
  stockMovement: 'written by inventory module',
  sparePart: 'legacy — superseded by AssetSparePart',

  // QR / public submission
  qrLocation: 'written by qr-locations module',
  buildingLocation: 'written by building-core module — canonical non-leasable spaces (lobby/restroom/mechanical)',
  occupantCompanySettings: 'written by occupants module — per-company billing/tax settings',

  // Approvals family
  approvalPolicy: 'written by approvals module',
  approvalRequest: 'written by approvals module',
  approvalStep: 'written by approvals module',
  approvalDelegation: 'written by approvals module',

  // Finance
  budget: 'written by reactive module (workorder budgeting)',
  budgetLine: 'written by reactive module',
  invoice: 'written by reactive + vendor-invoices modules',
  vendorInvoice: 'written by vendor-invoices module',
  account: 'reference data for accounting integration',

  // Vendors / contracts
  vendor: 'legacy — replaced by Organization with type=vendor',
  contract: 'written by leases module',

  // Projects
  project: 'written by projects module',
  projectStage: 'written by projects module',
  projectBudgetLine: 'written by projects module',
  changeOrder: 'written by projects module',
  acceptancePack: 'written by takeover + projects modules',
  tenantRepresentative: 'written by takeover module',

  // Devices / sensors
  device: 'written by devices module',
  sensorPoint: 'written by devices module',
  alarmSource: 'written by devices module',

  // Privacy / GDPR
  personalDataCategory: 'written by privacy module + seed',
  dpaTemplate: 'seeded by privacy module',
  subprocessorRegistry: 'written by privacy module',
  dsarRequest: 'written by privacy module',

  // Imports
  importJob: 'written by imports module',
  importJobRow: 'written by imports module',

  // Identity provider (SSO)
  identityProvider: 'written by sso module',

  // Notifications: legacy `notification` row promoted to OWNERSHIP under
  // notifications module (INIT-014) — removed from EXEMPT.
  residentRequest: 'legacy — superseded by ServiceRequest',

  // Rounds
  round: 'written by rounds module',
  roundWaypoint: 'written by rounds module',
  roundInstance: 'written by rounds module',
  roundInstanceAnswer: 'written by rounds module',

  // Leases
  leaseAllocation: 'written by leases module',

  // Building unit family — building-core owns; some cross-write through occupants
  buildingUnitGroup: 'written by building-core (group merge); occupants can update group on assign',

  // Cleaning extras
  cleaningQrPoint: 'written by cleaning module',
};

// ── Tests ──────────────────────────────────────────────────────

test('every Prisma model is either in OWNERSHIP or EXEMPT — no silent gaps', () => {
  const models = listModels();
  const owned = listOwnershipKeys();
  const exempt = new Set(Object.keys(EXEMPT));

  const uncovered = models.filter((m) => !owned.has(m) && !exempt.has(m));
  if (uncovered.length > 0) {
    assert.fail(
      `${uncovered.length} Prisma delegate(s) not classified:\n` +
        uncovered.map((m) => `  · ${m}`).join('\n') +
        `\n\nFix: add to apps/api/test/ssot-ownership.test.mjs OWNERSHIP map ` +
        `(if a single module is the canonical writer), or add to EXEMPT in ` +
        `this file with a one-line reason. ` +
        `See docs/architecture/platform-development-contract.md § 3.`,
    );
  }
});

test('EXEMPT entries do not double-up with OWNERSHIP', () => {
  const owned = listOwnershipKeys();
  const overlap = Object.keys(EXEMPT).filter((k) => owned.has(k));
  assert.equal(
    overlap.length,
    0,
    `EXEMPT and OWNERSHIP overlap: ${overlap.join(', ')}\n` +
      `Pick one. EXEMPT means "no single owner / not a real domain entity"; ` +
      `OWNERSHIP means "this module is the canonical writer".`,
  );
});

test('every EXEMPT entry has a non-empty reason', () => {
  for (const [delegate, reason] of Object.entries(EXEMPT)) {
    assert.ok(
      typeof reason === 'string' && reason.length >= 10,
      `EXEMPT[${delegate}]: reason must be a real sentence, got ${JSON.stringify(reason)}`,
    );
  }
});

test('EXEMPT delegates still exist as Prisma models (no stale entries)', () => {
  const models = new Set(listModels());
  const stale = Object.keys(EXEMPT).filter((d) => !models.has(d));
  assert.equal(
    stale.length,
    0,
    `EXEMPT contains stale delegates: ${stale.join(', ')}\n` +
      `Remove them — these models no longer exist in schema.prisma.`,
  );
});
