// PERF-001 Stage 2 — pin the withTenant() batching contract.
//
// Three properties keep the optimisation honest:
//
//   1. PrismaService.withTenant(tenantId, fn, tag) records ONE
//      _withTenant timing observation per call (so /metrics still
//      shows the DB cost of batched endpoints).
//   2. The 3 hot endpoints (tasks.inbox, role-dashboards.buildingManagerToday,
//      building-core.summary) MUST use withTenant — otherwise we're
//      back to N RLS transactions per request.
//   3. Each call site passes a unique non-default tag — so /metrics
//      can attribute Prisma cost back to the call site without source-
//      diving.
//
// If a refactor strips withTenant from any hot endpoint, the gate fails.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, '..', 'src');

const prismaService = readFileSync(join(apiSrc, 'prisma', 'prisma.service.ts'), 'utf8');
const tasksService = readFileSync(join(apiSrc, 'modules', 'tasks', 'tasks.service.ts'), 'utf8');
const roleDashboardsService = readFileSync(
  join(apiSrc, 'modules', 'role-dashboards', 'role-dashboards.service.ts'),
  'utf8',
);
const buildingCoreService = readFileSync(
  join(apiSrc, 'modules', 'building-core', 'building-core.service.ts'),
  'utf8',
);

test('withTenant accepts a tag arg and records _withTenant timing', () => {
  // Signature: withTenant(tenantId, fn, tag = 'unknown')
  assert.match(
    prismaService,
    /async withTenant<T>\(\s*tenantId:\s*string,\s*fn:\s*\([^)]*\)\s*=>\s*Promise<T>,\s*tag\s*=\s*['"]unknown['"]/,
    'withTenant must accept a `tag` parameter (call-site name) for /metrics attribution',
  );
  // recordQueryTiming under the synthetic _withTenant model
  assert.match(
    prismaService,
    /recordQueryTiming\(\s*['"]_withTenant['"]\s*,\s*tag\s*,\s*ms\s*\)/,
    'withTenant must emit a recordQueryTiming("_withTenant", tag, ms) observation',
  );
});

test('tasks.inbox uses withTenant with the canonical tag', () => {
  assert.match(
    tasksService,
    /this\.prisma\.withTenant\([\s\S]*?['"]tasks\.inbox['"]/,
    "tasks.inbox must call this.prisma.withTenant(..., 'tasks.inbox')",
  );
  // Within the inbox method body specifically, the unioned-leg reads
  // (taskInstance / cleaningRequest / incident / serviceRequest) must
  // go through `tx.`, not `this.prisma.`. Other methods on this
  // service (list, get, transition) keep using the auto-wrap path —
  // those are single-call paths where withTenant is overkill.
  const inboxStart = tasksService.indexOf('async inbox(');
  const inboxEnd = tasksService.indexOf('\n  async list(', inboxStart);
  assert.ok(inboxStart >= 0 && inboxEnd > inboxStart, 'inbox method body not found');
  const inboxBody = tasksService.slice(inboxStart, inboxEnd);
  for (const delegate of ['cleaningRequest', 'incident', 'serviceRequest']) {
    const re = new RegExp(`this\\.prisma\\.${delegate}\\.findMany`);
    assert.doesNotMatch(
      inboxBody,
      re,
      `inbox() must not call this.prisma.${delegate}.findMany — should be tx.${delegate}.findMany inside withTenant`,
    );
  }
  // taskInstance.findMany inside inbox should be on tx, not this.prisma
  const inboxThisPrismaTask = inboxBody.match(/this\.prisma\.taskInstance\.findMany/g);
  assert.equal(
    (inboxThisPrismaTask || []).length,
    0,
    'inbox() must not call this.prisma.taskInstance.findMany — use tx.taskInstance.findMany',
  );
});

test('tasks.inbox supports buildingId + cursor + take query params', () => {
  // Source-level pin for INIT-009 Stage 3 contract.
  assert.match(
    tasksService,
    /buildingId\?:\s*string/,
    'inbox opts must include buildingId?: string',
  );
  assert.match(tasksService, /cursor\?:\s*string/, 'inbox opts must include cursor?: string');
  assert.match(tasksService, /take\?:\s*number/, 'inbox opts must include take?: number');
  // Cursor must clip per leg — at minimum one leg should apply
  // `cursorClause` to its where clause.
  assert.match(
    tasksService,
    /cursorClause\s*\?\s*\{\s*[a-zA-Z]+:\s*\{\s*lt:\s*cursorClause\s*\}\s*\}/,
    'inbox must apply cursor clause `{ lt: cursorClause }` to per-leg timestamp filters',
  );
});

test('role-dashboards.buildingManagerToday uses withTenant', () => {
  assert.match(
    roleDashboardsService,
    /this\.prisma\.withTenant\([\s\S]*?['"]role-dashboards\.buildingManagerToday['"]/,
    "buildingManagerToday must call this.prisma.withTenant(..., 'role-dashboards.buildingManagerToday')",
  );
});

test('building-core.summary uses withTenant', () => {
  assert.match(
    buildingCoreService,
    /this\.prisma\.withTenant\([\s\S]*?['"]building-core\.summary['"]/,
    "summary() must call this.prisma.withTenant(..., 'building-core.summary')",
  );
});

test('every withTenant call passes a non-default tag', () => {
  // Each refactored service should reference its canonical tag string.
  // Pin the canonical set explicitly — losing one of these means a
  // call site dropped the tag and went back to 'unknown' (or got
  // refactored away from withTenant entirely).
  const expectedTags = [
    ['tasks.service.ts', tasksService, 'tasks.inbox'],
    ['role-dashboards.service.ts', roleDashboardsService, 'role-dashboards.buildingManagerToday'],
    ['building-core.service.ts', buildingCoreService, 'building-core.summary'],
  ];
  for (const [name, src, tag] of expectedTags) {
    const re = new RegExp(`['"]${tag.replace(/\./g, '\\.')}['"]`);
    assert.match(src, re, `${name} must declare withTenant tag '${tag}'`);
  }
});
