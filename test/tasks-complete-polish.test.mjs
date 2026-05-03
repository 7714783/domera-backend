// INIT-003 NS-9 — pin /v1/tasks/:id/complete polish bug at the source.
//
// History: a polish bug had been suspected where calling
// POST /v1/tasks/:id/complete persisted `status` + `completedAt` +
// `result` + `evidenceDocuments` correctly but silently dropped
// `lifecycleStage` + `completedByUserId`. Cause was unconfirmed —
// suspected interaction between PrismaService.$extends $allOperations
// + $transaction wrap + Nest argument serialisation. The polish bug
// was never reproduced after later PrismaService refactors.
//
// This test pins the contract at the source so a future regression
// is caught at PR time, without needing a live DB:
//
//   1. The complete() body must declare all five fields on the
//      transition() extra payload.
//   2. The transition() helper must spread `extra` into `data`
//      alongside `status` so every field reaches the prisma update.
//
// If a refactor narrows the field set or drops the spread, this
// gate fails and the engineer must restore the canonical shape.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const servicePath = join(here, '..', 'src', 'modules', 'tasks', 'tasks.service.ts');
const src = readFileSync(servicePath, 'utf8');

test('complete() payload includes all 5 fields the polish-bug history pinned', () => {
  // Locate the complete() method body. Span: from `async complete(` to
  // the next top-level method declaration (closing `}`).
  const start = src.indexOf('async complete(');
  assert.ok(start >= 0, 'complete() method not found in tasks.service.ts');
  const end = src.indexOf('\n  async ', start + 1);
  const body = end > start ? src.slice(start, end) : src.slice(start);

  const required = [
    'lifecycleStage',
    'completedAt',
    'completedByUserId',
    'result',
    'evidenceDocuments',
  ];
  for (const field of required) {
    assert.ok(
      body.includes(`${field}:`),
      `complete() body must pass \`${field}\` in the transition payload (polish-bug regression guard).`,
    );
  }
});

test('transition() spreads `extra` into the prisma update data', () => {
  // The shape `data: { status: nextStatus, ...extra }` must remain.
  // If a refactor moves to explicit field-by-field assignment, the
  // pin must be updated to match — but right now we want to know.
  assert.match(
    src,
    /data:\s*\{\s*status:\s*nextStatus,\s*\.\.\.extra\s*\}/,
    'transition() must spread `...extra` into the prisma.taskInstance.update data — otherwise complete()-supplied fields silently drop.',
  );
});

test('complete() rejects when evidenceRequired but no documents supplied', () => {
  // Pin the explicit guard, separate from the field-shape contract.
  // A missing guard would let evidenceRequired=true tasks close with
  // empty evidence and break compliance reports downstream.
  assert.match(
    src,
    /task\.evidenceRequired\s*&&[\s\S]{0,200}throw\s+new\s+BadRequestException\(['"`]evidence required/,
    'complete() must throw BadRequestException("evidence required") when evidenceRequired is true and body has no documents.',
  );
});
