// INIT-014 — inbound-email security invariants.
//
// Static checks against inbound-email.service.ts and the controller —
// no DB. Invariants:
//   1. The service stores the raw payload BEFORE accepting the message
//      (forensic value on signature failure).
//   2. Cross-tenant linkage is refused: linkedEntityExists guards on
//      tenantId match.
//   3. Controller throws UnauthorizedException when signature invalid.
//   4. RawPayload column is JSONB (already enforced by migration; we
//      validate by checking the SQL).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const svc = readFileSync(
  resolve(here, '..', 'src', 'modules', 'notifications', 'inbound-email.service.ts'),
  'utf8',
);
const ctl = readFileSync(
  resolve(here, '..', 'src', 'modules', 'notifications', 'notifications.controller.ts'),
  'utf8',
);
const sql = readFileSync(
  resolve(here, '..', 'prisma', 'migrations-sql', '020_notifications_unified.sql'),
  'utf8',
);

test('service writes the raw payload BEFORE accepting the message', () => {
  // The .create({ data: { ... rawPayload ... } }) call must come BEFORE
  // any return path that accepts the message. We assert that the create
  // happens unconditionally near the top of `ingest`.
  const ingestStart = svc.indexOf('async ingest(');
  assert.ok(ingestStart > 0, 'ingest() not found');
  const tail = svc.slice(ingestStart);
  const createIdx = tail.indexOf('.emailInboundEvent.create(');
  const sigCheckRejectIdx = tail.indexOf('signatureValid: false');
  assert.ok(createIdx > 0, 'no create() call in ingest()');
  assert.ok(
    createIdx < sigCheckRejectIdx || sigCheckRejectIdx === -1,
    'raw payload must be persisted before any "signatureValid: false" return',
  );
});

test('cross-tenant linkage is refused via tenantId match', () => {
  // linkedEntityExists must filter every Prisma .findFirst on tenantId.
  const fn = svc.match(/private async linkedEntityExists\([\s\S]*?\n  \}/);
  assert.ok(fn, 'linkedEntityExists not found');
  const body = fn[0];
  // Every findFirst inside must include `tenantId` in its where.
  const findFirsts = [...body.matchAll(/findFirst\(\s*\{\s*where:\s*\{([^}]+)\}/g)];
  assert.ok(findFirsts.length >= 2, 'linkedEntityExists has too few findFirst calls');
  for (const m of findFirsts) {
    assert.ok(
      m[1].includes('tenantId'),
      `linkedEntityExists has a findFirst without tenantId guard: ${m[1].trim().slice(0, 80)}`,
    );
  }
});

test('controller rejects invalid signature with UnauthorizedException', () => {
  assert.match(
    ctl,
    /if\s*\(\s*!result\.signatureValid\s*\)[\s\S]*?throw new UnauthorizedException/,
    'inbound controller must throw UnauthorizedException when signatureValid is false',
  );
});

test('email_inbound_events stores rawPayload as JSONB', () => {
  assert.match(
    sql,
    /"rawPayload"\s+JSONB\s+NOT\s+NULL/i,
    'rawPayload column must be JSONB NOT NULL',
  );
});

test('email_inbound_events table has receivedAt + status columns for forensics', () => {
  assert.match(sql, /"receivedAt"\s+TIMESTAMP/i);
  assert.match(sql, /"status"\s+TEXT NOT NULL DEFAULT 'received'/i);
  assert.match(sql, /"signatureValid"\s+BOOLEAN NOT NULL DEFAULT FALSE/i);
});

test('inbound webhook URL pattern includes :provider for signature dispatch', () => {
  assert.match(ctl, /@Post\(['"]:provider['"]\)/);
});
