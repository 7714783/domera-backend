// GROWTH-001 NS-22 + NS-23 — pin the operational tooling contract.
//
// Properties this gate keeps honest:
//
//   1. invites.service.ts publishes invite.created with recipientEmails
//      + acceptUrl in the payload — the notifications mailer rule uses
//      the manual recipientStrategy and would otherwise have nobody to
//      send to.
//   2. notifications.subscribers.ts subscribes to invite.created.
//   3. migration 025 adds the invite.created template + rule.
//   4. TenancyService.suspend / reactivate / exportFull are all owner-
//      gated AND require slug-verbatim confirmText.
//   5. TenantMiddleware refuses non-GET requests when tenant is
//      suspended, EXCEPT for /v1/admin/tenants/* paths (so an owner
//      can reactivate without a bootstrap deadlock).
//   6. The ops runbook + on-call doc both exist (not aspirational
//      stubs — the headers we pin must be present).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, '..', 'src');
const repoRoot = join(here, '..', '..', '..');

const invitesService = readFileSync(
  join(apiSrc, 'modules', 'invites', 'invites.service.ts'),
  'utf8',
);
const subscribers = readFileSync(
  join(apiSrc, 'modules', 'notifications', 'notifications.subscribers.ts'),
  'utf8',
);
const migration025 = readFileSync(
  join(apiSrc, '..', 'prisma', 'migrations-sql', '025_invite_email_template.sql'),
  'utf8',
);
const tenancyService = readFileSync(
  join(apiSrc, 'modules', 'tenancy', 'tenancy.service.ts'),
  'utf8',
);
const tenancyController = readFileSync(
  join(apiSrc, 'modules', 'tenancy', 'tenancy.controller.ts'),
  'utf8',
);
const middleware = readFileSync(join(apiSrc, 'common', 'tenant.middleware.ts'), 'utf8');

// Try to read runbook docs from the monorepo root; skip if not present
// (we are running from the gh/domera-backend split slice).
let runbook = '';
let oncall = '';
try {
  runbook = readFileSync(join(repoRoot, 'docs', 'operations', 'runbook.md'), 'utf8');
  oncall = readFileSync(join(repoRoot, 'docs', 'operations', 'oncall.md'), 'utf8');
} catch {
  // Split slice — docs aren't mirrored. Tests below skip themselves.
}

test('invites.service publishes invite.created with recipientEmails + acceptUrl', () => {
  // Both keys must be in the outbox payload — without them the
  // notifications mailer's manual strategy has no address to email.
  assert.match(
    invitesService,
    /type:\s*['"]invite\.created['"][\s\S]*?recipientEmails:\s*\[invite\.email\]/,
    'invite.created payload must include recipientEmails: [invite.email]',
  );
  assert.match(
    invitesService,
    /type:\s*['"]invite\.created['"][\s\S]*?acceptUrl/,
    'invite.created payload must include acceptUrl',
  );
});

test('notifications.subscribers includes invite.created', () => {
  assert.match(
    subscribers,
    /SUBSCRIBED_EVENTS\s*=\s*\[[\s\S]*?['"]invite\.created['"]/,
    "notifications.subscribers SUBSCRIBED_EVENTS must include 'invite.created'",
  );
});

test('migration 025 inserts invite.created template + rule', () => {
  assert.match(migration025, /'invite\.created'/);
  assert.match(
    migration025,
    /INSERT INTO "notification_templates"[\s\S]*?'invite\.created'[\s\S]*?'email'/,
    'migration must insert email template keyed invite.created',
  );
  assert.match(
    migration025,
    /INSERT INTO "notification_rules"[\s\S]*?'invite\.created'[\s\S]*?'manual'/,
    'migration must insert rule with recipientStrategy=manual',
  );
});

test('TenancyService.suspend / reactivate / exportFull are owner-gated', () => {
  // Every public method must call assertOwnerOrSuperadmin first.
  for (const method of ['async suspend', 'async reactivate', 'async exportFull']) {
    const sig = new RegExp(
      `${method}\\([\\s\\S]*?\\)\\s*\\{[\\s\\S]*?await this\\.assertOwnerOrSuperadmin\\(`,
    );
    assert.match(tenancyService, sig, `${method} must call assertOwnerOrSuperadmin`);
  }
});

test('TenancyService gate requires slug-verbatim confirmText', () => {
  assert.match(
    tenancyService,
    /confirmText\.trim\(\)\s*!==\s*tenant\.slug/,
    'resolveTenantOrThrow must compare confirmText.trim() === tenant.slug verbatim',
  );
});

test('TenancyController exposes suspend / reactivate / export under /admin/tenants', () => {
  assert.match(tenancyController, /@Controller\('admin\/tenants'\)/);
  assert.match(tenancyController, /@Post\(\s*['"]:id\/suspend['"]\s*\)/);
  assert.match(tenancyController, /@Post\(\s*['"]:id\/reactivate['"]\s*\)/);
  assert.match(tenancyController, /@Post\(\s*['"]:id\/export['"]\s*\)/);
});

test('TenantMiddleware refuses non-GET on suspended tenants', () => {
  // The pin: middleware checks tenant.status === 'suspended' and
  // throws ForbiddenException for non-GET methods.
  assert.match(
    middleware,
    /req\.method\s*!==\s*['"]GET['"]\s*&&\s*req\.method\s*!==\s*['"]HEAD['"]/,
    'middleware must guard suspended-tenant check on non-GET only',
  );
  assert.match(
    middleware,
    /status\s*===\s*['"]suspended['"][\s\S]*?ForbiddenException/,
    'middleware must throw ForbiddenException when tenant.status is suspended',
  );
});

test('admin/tenants paths skip the suspended-tenant guard', () => {
  // Bootstrap deadlock would otherwise prevent reactivation of own
  // home tenant.
  assert.match(
    middleware,
    /SUSPEND_GUARD_BYPASS_PREFIXES\s*=\s*\[\s*['"]\/v1\/admin\/tenants\/['"]/,
    'admin/tenants paths must be in SUSPEND_GUARD_BYPASS_PREFIXES',
  );
});

test('runbook.md and oncall.md document the four operational sections', () => {
  if (!runbook || !oncall) return; // split slice — see top of file
  // Headings the on-call doc references back to. If any of these
  // sections gets renamed or deleted, oncall.md links break.
  for (const h of [
    '## Tenant kill-switch',
    '## Emergency tenant export',
    '## RLS leak triage',
    '## Auth diagnostics',
    '## Perf diagnostics',
    '## Outbox triage',
    '## Mailer kill-switch',
  ]) {
    assert.ok(runbook.includes(h), `runbook.md must contain section "${h}"`);
  }
  for (const h of [
    '## Severity ladder',
    '## First response checklist',
    '## Post-mortem template',
  ]) {
    assert.ok(oncall.includes(h), `oncall.md must contain section "${h}"`);
  }
});
