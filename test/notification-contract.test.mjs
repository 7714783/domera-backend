// INIT-014 — every system NotificationRule must reference a real
// NotificationTemplate, and every template's `variables[]` must
// match the placeholders in subject/bodyHtml/bodyText.
//
// Static parse of the seed SQL (020_notifications_unified.sql). Doesn't
// hit a DB — runs in CI without infrastructure.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(
  here,
  '..',
  'prisma',
  'migrations-sql',
  '020_notifications_unified.sql',
);
const sql = readFileSync(sqlPath, 'utf8');

// ── Parse seeded templates ──────────────────────────────────────────
function parseTemplates() {
  const out = [];
  const re =
    /INSERT INTO "notification_templates"[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/m;
  const m = sql.match(re);
  if (!m) return out;
  const body = m[1];
  // Each row is wrapped in (...) — split on `),\n  (`.
  const rowRe =
    /\(\s*gen_random_uuid\(\)::text\s*,\s*NULL\s*,\s*FALSE\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']*?(?:''[^']*?)*)'\s*,\s*'([^']*?(?:''[^']*?)*)'\s*,\s*'([^']*?(?:''[^']*?)*)'\s*,\s*ARRAY\[([^\]]+)\]/g;
  let r;
  while ((r = rowRe.exec(body)) !== null) {
    out.push({
      key: r[1],
      channel: r[2],
      locale: r[3],
      subject: r[4].replace(/''/g, "'"),
      bodyText: r[5].replace(/''/g, "'"),
      bodyHtml: r[6].replace(/''/g, "'"),
      variables: [...r[7].matchAll(/'([^']+)'/g)].map((x) => x[1]),
    });
  }
  return out;
}

function parseRules() {
  const out = [];
  const re =
    /INSERT INTO "notification_rules"[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/m;
  const m = sql.match(re);
  if (!m) return out;
  const body = m[1];
  const rowRe =
    /\(\s*gen_random_uuid\(\)::text\s*,\s*NULL\s*,\s*FALSE\s*,\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*'([^']+)'\s*,\s*ARRAY\[([^\]]+)\]\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g;
  let r;
  while ((r = rowRe.exec(body)) !== null) {
    out.push({
      name: r[1],
      eventType: r[2],
      channels: [...r[3].matchAll(/'([^']+)'/g)].map((x) => x[1]),
      templateKey: r[4],
      recipientStrategy: r[5],
    });
  }
  return out;
}

const templates = parseTemplates();
const rules = parseRules();

test('seed parser found at least one rule and one template', () => {
  assert.ok(templates.length > 0, 'no templates parsed from migration 020 — parser drift');
  assert.ok(rules.length > 0, 'no rules parsed from migration 020 — parser drift');
});

test('every rule.templateKey references an existing template', () => {
  const keys = new Set(templates.map((t) => t.key));
  for (const r of rules) {
    if (!r.templateKey) continue; // rules with channels=['inapp'] only may skip
    assert.ok(
      keys.has(r.templateKey),
      `rule "${r.name}" references missing templateKey: ${r.templateKey}`,
    );
  }
});

test('every rule with channel=email has a template registered for the email channel', () => {
  const byKeyChannel = new Set(templates.map((t) => `${t.key}:${t.channel}`));
  for (const r of rules) {
    if (!r.templateKey) continue;
    if (!r.channels.includes('email')) continue;
    assert.ok(
      byKeyChannel.has(`${r.templateKey}:email`),
      `rule "${r.name}" emits email but no email template for ${r.templateKey}`,
    );
  }
});

test('every template variable referenced in subject/body is declared in variables[]', () => {
  for (const tpl of templates) {
    const refs = new Set();
    const collect = (s) => {
      if (!s) return;
      const re = /\{\{\{?([\w.]+)\}?\}\}/g;
      let m;
      while ((m = re.exec(s)) !== null) refs.add(m[1].split('.')[0]);
    };
    collect(tpl.subject);
    collect(tpl.bodyText);
    collect(tpl.bodyHtml);
    const declared = new Set(tpl.variables);
    const missing = [...refs].filter((v) => !declared.has(v));
    assert.deepEqual(
      missing,
      [],
      `template "${tpl.key}" (${tpl.channel}/${tpl.locale}) references undeclared vars: ${missing.join(', ')}`,
    );
  }
});

test('rule.recipientStrategy is one of the canonical values', () => {
  const allowed = new Set(['assignee', 'role', 'manual']);
  for (const r of rules) {
    assert.ok(
      allowed.has(r.recipientStrategy),
      `rule "${r.name}" has unknown recipientStrategy: ${r.recipientStrategy}`,
    );
  }
});
