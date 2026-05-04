// GROWTH-001 NS-21 — pin the iam invite.accepted subscriber contract.
//
// Five properties keep the invite→membership wiring honest:
//
//   1. IamService implements OnModuleInit + registers a handler on
//      'invite.accepted' (no other registration site for this event).
//   2. The handler short-circuits cleanly when payload is missing
//      tenantId/email/roleKey/inviteId — does NOT crash the dispatcher.
//   3. User dedup is by emailNormalized (the canonical unique column),
//      lowercased — same human across workspaces resolves to ONE user.
//   4. Membership upsert is idempotent — handler checks for an existing
//      (tenantId, userId, roleKey) row before creating, so at-least-once
//      replay is a no-op.
//   5. Password hashing uses bcrypt at cost ≥ 10 (we use 12 to match
//      auth.service); plaintext password is never persisted.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, '..', 'src');

const iamService = readFileSync(join(apiSrc, 'modules', 'iam', 'iam.service.ts'), 'utf8');

test('IamService implements OnModuleInit', () => {
  assert.match(
    iamService,
    /class IamService implements OnModuleInit/,
    'IamService must implement OnModuleInit so its event subscriber registers at boot',
  );
});

test('IamService registers invite.accepted handler exactly once', () => {
  const matches = iamService.match(/this\.outboxRegistry\.register\(\s*['"]invite\.accepted['"]/g);
  assert.ok(matches, "iam.service.ts must register a handler for 'invite.accepted'");
  assert.equal(
    matches.length,
    1,
    'invite.accepted should be registered EXACTLY once (duplicate registrations cause double-membership creation)',
  );
});

test('handler short-circuits on missing payload fields', () => {
  // Required fields are tenantId, email, roleKey, inviteId. The handler
  // must early-return when any are missing rather than throwing — a
  // throw would crash the dispatcher and block every other event.
  assert.match(
    iamService,
    /if \(!tenantId \|\| !email \|\| !roleKey \|\| !inviteId\)\s*\{[\s\S]*?return/,
    'handler must return early when tenantId/email/roleKey/inviteId is missing',
  );
});

test('user dedup uses emailNormalized + lowercased lookup', () => {
  // The canonical UNIQUE column is emailNormalized; we MUST look up
  // there, not on `email` (which has no unique constraint).
  assert.match(
    iamService,
    /findUnique\(\s*\{\s*where:\s*\{\s*emailNormalized:\s*lower\s*\}/,
    'user lookup must be findUnique({ where: { emailNormalized: lower } })',
  );
  // The lowercase normalisation must happen explicitly.
  assert.match(
    iamService,
    /const lower\s*=\s*email\.toLowerCase\(\)/,
    'email must be lowercased before lookup (emailNormalized is the canonical key)',
  );
});

test('membership creation is idempotent (findFirst guards create)', () => {
  // Same handler fires N times under at-least-once delivery. The pin:
  // before create, findFirst on (tenantId, userId, roleKey) — if a row
  // exists, skip create.
  assert.match(
    iamService,
    /membership\.findFirst\(\s*\{\s*where:\s*\{\s*tenantId,\s*userId,\s*roleKey\s*\}/,
    'handler must guard membership.create with a (tenantId, userId, roleKey) findFirst',
  );
});

test('password hashing uses bcrypt at cost ≥ 10', () => {
  // We pass 12 to match auth.service. Anything below 10 is too cheap.
  const m = iamService.match(/bcrypt\.hash\(\s*password\s*,\s*(\d+)\s*\)/);
  assert.ok(m, 'password hashing must use bcrypt.hash(password, <cost>)');
  const cost = Number(m[1]);
  assert.ok(cost >= 10, `bcrypt cost must be ≥ 10 (got ${cost})`);
});

test('plaintext password never persisted', () => {
  // The User.create call must reference passwordHash, not password.
  // We grep narrow inside the create call.
  const createMatch = iamService.match(/user\.create\(\s*\{[\s\S]*?\}\s*\)/);
  assert.ok(createMatch, 'user.create call not found');
  const body = createMatch[0];
  assert.match(body, /passwordHash/, 'user.create must persist passwordHash');
  assert.doesNotMatch(
    body,
    /^[\s\S]*?\bpassword:\s*password\b/,
    'user.create must NOT pass plaintext password — only the hash',
  );
});
