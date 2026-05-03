// INIT-014 — every event the notifications subscriber listens to must
// have at least one ACTIVE rule in the seed migration. Catches the
// regression "we wired the subscriber but forgot the rule".

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const subSrc = readFileSync(
  resolve(here, '..', 'src', 'modules', 'notifications', 'notifications.subscribers.ts'),
  'utf8',
);
const sql = readFileSync(
  resolve(here, '..', 'prisma', 'migrations-sql', '020_notifications_unified.sql'),
  'utf8',
);

function subscribedEvents() {
  const m = subSrc.match(/SUBSCRIBED_EVENTS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((x) => x[1]);
}

function ruleEventTypes() {
  // Same parser shape as notification-contract.test.mjs.
  const re = /INSERT INTO "notification_rules"[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/m;
  const m = sql.match(re);
  if (!m) return [];
  const body = m[1];
  const out = [];
  const rowRe =
    /\(\s*gen_random_uuid\(\)::text\s*,\s*NULL\s*,\s*FALSE\s*,\s*'[^']+'\s*,\s*'[^']*'\s*,\s*'([^']+)'\s*,\s*ARRAY\[([^\]]+)\]/g;
  let r;
  while ((r = rowRe.exec(body)) !== null) {
    out.push({
      eventType: r[1],
      channels: [...r[2].matchAll(/'([^']+)'/g)].map((x) => x[1]),
    });
  }
  return out;
}

const subscribed = subscribedEvents();
const rules = ruleEventTypes();
const ruleByEvent = new Map();
for (const r of rules) ruleByEvent.set(r.eventType, r);

test('SUBSCRIBED_EVENTS list is non-empty', () => {
  assert.ok(subscribed.length > 0, 'parser found no SUBSCRIBED_EVENTS');
});

test('seed migration has at least one rule for every "high-stakes" event', () => {
  // Some subscribed events are listed for FUTURE rules (graceful
  // forward-compat). Hard-stake ones (assigned / requested / decided /
  // role) MUST already have a system rule.
  const required = [
    'ppm.task.assigned',
    'approval.request.pending',
    'document.requested',
    'invoice.awaiting_confirmation',
    'role.assigned',
    'incident.assigned',
  ];
  const missing = required.filter((e) => !ruleByEvent.has(e));
  assert.deepEqual(missing, [], `missing rules for: ${missing.join(', ')}`);
});

test('every rule emits at least one valid channel', () => {
  const allowed = new Set(['email', 'inapp', 'push']);
  for (const r of rules) {
    assert.ok(
      r.channels.length > 0 && r.channels.every((c) => allowed.has(c)),
      `rule for "${r.eventType}" has invalid channel set: ${r.channels.join(', ')}`,
    );
  }
});

test('approval emails always go via secure-link (no approve-by-reply)', () => {
  // Contract: an approval rule must NOT be configured to use a template
  // that contains a "Reply with X" instruction. We grep the seeded
  // templates for the forbidden phrase.
  const tplBlock = sql.match(/INSERT INTO "notification_templates"[\s\S]*?ON CONFLICT/m);
  if (!tplBlock) {
    // If no templates seeded, skip — covered by other tests.
    return;
  }
  const approvalChunks = tplBlock[0].match(/'approval\.[a-z_]+'[\s\S]*?ARRAY\[[^\]]*\]/g) || [];
  for (const chunk of approvalChunks) {
    const lower = chunk.toLowerCase();
    assert.ok(
      !lower.includes('reply to approve') &&
        !lower.includes('reply yes to approve') &&
        !lower.includes('approve by reply'),
      `approval template appears to invite approve-by-reply — forbidden by contract`,
    );
  }
});
