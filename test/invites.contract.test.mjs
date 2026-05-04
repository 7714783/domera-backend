// GROWTH-001 NS-19 — pin the invites module contract.
//
// Six properties keep the invite flow honest at refactor time:
//
//   1. Tokens are stored HASHED (sha256), never plaintext.
//   2. Plaintext token is returned ONCE at create time (so the inviter
//      can share manually) AND emitted in the invite.created outbox
//      payload (for the notifications mailer).
//   3. Manager-gated create + list + revoke (uses the shared
//      requireManager helper).
//   4. Public accept route (no Bearer required) is rate-limited per IP.
//   5. Single-use semantics — accept transitions pending→accepted; a
//      second accept on the same token returns 400.
//   6. 72h TTL baked into expiresAt at create time; accept after expiry
//      auto-flips status to expired and returns 403.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, '..', 'src');

const service = readFileSync(join(apiSrc, 'modules', 'invites', 'invites.service.ts'), 'utf8');
const controller = readFileSync(
  join(apiSrc, 'modules', 'invites', 'invites.controller.ts'),
  'utf8',
);
const migration = readFileSync(
  join(apiSrc, '..', 'prisma', 'migrations-sql', '024_invites.sql'),
  'utf8',
);

test('invite tokens are sha256-hashed before persistence', () => {
  assert.match(
    service,
    /createHash\(['"]sha256['"]\)\.update\(token,\s*['"]utf8['"]\)\.digest\(['"]hex['"]\)/,
    'tokens must be hashed via sha256 → hex digest before being stored',
  );
  // The create code path must store tokenHash, not the plaintext.
  assert.match(
    service,
    /data:\s*\{[\s\S]*?tokenHash[\s\S]*?\}/,
    'invite.create() must persist tokenHash (not plaintext token)',
  );
});

test('invite.create returns plaintext token ONCE', () => {
  // The return statement of `create()` must include `token` (plaintext)
  // — that's the inviter's escape hatch for manual sharing.
  assert.match(
    service,
    /return\s*\{[\s\S]*?token,?\s*\}/,
    'invite.create() must return the plaintext token in its response',
  );
});

test('invite.created outbox payload carries the plaintext token', () => {
  // The notifications mailer needs the plaintext to template the email.
  // The token in the outbox payload is intentionally NOT in the audit
  // entry — that's checked in the manual review, not here.
  assert.match(
    service,
    /type:\s*['"]invite\.created['"][\s\S]*?token,/,
    'invite.created outbox payload must include token',
  );
});

test('manager-gated create + list + revoke', () => {
  // Each manager-only method must call await requireManager(...)
  // before doing any work.
  for (const method of ['async create', 'async list', 'async revoke']) {
    const sig = new RegExp(`${method}\\s*\\([\\s\\S]*?\\)\\s*\\{[\\s\\S]*?await requireManager\\(`);
    assert.match(service, sig, `${method} must call await requireManager(...)`);
  }
});

test('public accept route is rate-limited per IP', () => {
  // Controller must invoke rateLimit({ key: 'invites:accept:<ip>', ... })
  // before delegating to the service.
  assert.match(
    controller,
    /rateLimit\(\{\s*key:\s*`invites:accept:\$\{ip\}`/,
    'POST /v1/invites/accept must be rate-limited per IP',
  );
  // No Bearer extraction in the accept handler (it's public).
  const acceptStart = controller.indexOf("@Post('accept')");
  const acceptEnd = controller.indexOf('}\n}', acceptStart);
  const acceptBody = controller.slice(acceptStart, acceptEnd);
  assert.doesNotMatch(
    acceptBody,
    /uid\(ah,\s*this\.auth\)/,
    'POST /v1/invites/accept must NOT call uid(authHeader, ...) — it is public',
  );
});

test('accept flips status pending→accepted (single-use)', () => {
  assert.match(
    service,
    /status:\s*['"]accepted['"][\s\S]*?acceptedAt:\s*new Date\(\)/,
    'accept() must set status="accepted" and acceptedAt=new Date() in the same update',
  );
  // Re-accept of an already-accepted invite must throw.
  assert.match(
    service,
    /invite\.status\s*===\s*['"]accepted['"][\s\S]*?BadRequestException/,
    'accept() must reject already-accepted invites with BadRequestException',
  );
});

test('72h TTL is baked at create time + expiry triggers status="expired"', () => {
  assert.match(
    service,
    /INVITE_TTL_HOURS\s*=\s*72/,
    'invite TTL constant must be 72 hours per GROWTH-001 NS-19 spec',
  );
  assert.match(
    service,
    /const expiresAt\s*=\s*new Date\(Date\.now\(\)\s*\+\s*INVITE_TTL_HOURS\s*\*\s*3600_?000\)/,
    'expiresAt must be set to now + 72h at create time (Date.now() + INVITE_TTL_HOURS * 3600_000)',
  );
  // Accept after expiry must auto-flip status to "expired".
  assert.match(
    service,
    /invite\.expiresAt\.getTime\(\)\s*<\s*Date\.now\(\)[\s\S]*?status:\s*['"]expired['"]/,
    'accept() must auto-flip status to "expired" when expiresAt < now',
  );
});

test('migration 024 creates invites with RLS + partial unique on pending email', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS invites/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY tenant_isolation ON invites/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS invites_tenant_email_pending_uniq[\s\S]*?WHERE status\s*=\s*'pending'/,
    'partial unique index must enforce one pending invite per (tenant, email)',
  );
});
