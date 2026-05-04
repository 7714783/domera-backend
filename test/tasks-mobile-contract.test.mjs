// Mobile contract alignment pin (NS-24).
//
// Mobile (apps/mobile/src/modules/tasks/tasksApi.ts) calls these
// three routes. The backend used to lack all of them — every mobile
// build would 404 on first interaction with a task. This pin guards
// the surface so a refactor cannot silently drop a route again.
//
// What we pin:
//   1. Controller exposes GET /:id/timeline, POST /:id/transition,
//      POST /:id/comments under @Controller('tasks').
//   2. Service exposes timeline / applyTransition / addComment with
//      shapes that match the mobile types
//      (apps/mobile/src/modules/tasks/types.ts).
//   3. Comment shape transform — TaskComment expects
//      { id, actor, message, createdAt }, NOT raw TaskNote
//      { id, authorUserId, body, createdAt }. Mobile TS would fail
//      if the shape leaked back to TaskNote.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(here, '..', 'src');

const controller = readFileSync(join(apiSrc, 'modules', 'tasks', 'tasks.controller.ts'), 'utf8');
const service = readFileSync(join(apiSrc, 'modules', 'tasks', 'tasks.service.ts'), 'utf8');

test('controller exposes the 3 mobile-contract routes', () => {
  assert.match(
    controller,
    /@Get\(\s*['"]:id\/timeline['"]\s*\)/,
    'GET /v1/tasks/:id/timeline must be wired',
  );
  assert.match(
    controller,
    /@Post\(\s*['"]:id\/transition['"]\s*\)/,
    'POST /v1/tasks/:id/transition must be wired',
  );
  assert.match(
    controller,
    /@Post\(\s*['"]:id\/comments['"]\s*\)/,
    'POST /v1/tasks/:id/comments must be wired',
  );
});

test('service emits the canonical mobile shapes', () => {
  // timeline -> { id, eventType, actor, createdAt, message }
  assert.match(
    service,
    /async timeline\([\s\S]*?\)\s*\{[\s\S]*?return entries\.map[\s\S]*?id:\s*e\.id[\s\S]*?eventType:[\s\S]*?actor:[\s\S]*?createdAt:[\s\S]*?message:/,
    'timeline() must shape AuditEntry rows to TaskTimelineEntry { id, eventType, actor, createdAt, message }',
  );
  // applyTransition (renamed to avoid clash with private state-machine helper)
  assert.match(
    service,
    /async applyTransition\([\s\S]*?body:\s*\{\s*toStatus\?:\s*string;\s*comment\?:\s*string\s*\}/,
    'service must export applyTransition(tenantId, taskId, actor, { toStatus, comment? })',
  );
  // addComment -> mobile shape { id, actor, message, createdAt }
  assert.match(
    service,
    /async addComment\([\s\S]*?\)\s*\{[\s\S]*?return\s*\{\s*id:[\s\S]*?actor:[\s\S]*?message:[\s\S]*?createdAt:/,
    'addComment() must return TaskComment shape { id, actor, message, createdAt } — not raw TaskNote',
  );
});

test('comment endpoint maps message → addNote body and back to TaskComment', () => {
  // The mobile `addTaskComment(id, message)` call sends `{ message }`.
  // Our addComment must call addNote with { body: message } and
  // return the mobile shape mapping authorUserId → actor, body → message.
  assert.match(
    service,
    /this\.addNote\(tenantId,\s*taskId,\s*actorUserId,\s*\{\s*body:\s*body\?\.message\s*\}\)/,
    'addComment must delegate to addNote with { body: message } payload mapping',
  );
});

test('applyTransition disambiguates in_progress (start vs resume) by current status', () => {
  // Mobile sends a single verb 'in_progress' for both fresh-start and
  // resume-from-paused. Server must read current status and route
  // correctly — pin the exact dispatch shape.
  assert.match(
    service,
    /case\s+['"]in_progress['"][\s\S]*?task\.status\s*===\s*['"]paused['"][\s\S]*?this\.resume[\s\S]*?this\.start/,
    'applyTransition case in_progress must check task.status === paused and route to resume() vs start()',
  );
  assert.match(
    service,
    /case\s+['"]paused['"][\s\S]*?this\.pause/,
    'applyTransition case paused must call this.pause()',
  );
  assert.match(
    service,
    /case\s+['"]completed['"][\s\S]*?this\.complete/,
    'applyTransition case completed must call this.complete()',
  );
});

test('timeline scopes by entityType="taskInstance" + entity=:id', () => {
  // Critical for tenant safety + correct filtering. If someone changes
  // entityType to "task" (without underscore-camel) the audit join
  // breaks silently and timelines return empty.
  assert.match(
    service,
    /entityType:\s*['"]taskInstance['"][\s\S]*?entity:\s*taskId/,
    'timeline must filter AuditEntry by entityType="taskInstance" + entity=taskId',
  );
});

test('every new method validates task ownership via tenantId before reading', () => {
  // Each method must look up the TaskInstance by (id, tenantId) before
  // doing other work — RLS auto-wrap handles cross-tenant blocking but
  // a 404 (not 403) is the friendlier client-facing answer when the
  // task simply does not exist for this tenant.
  for (const m of ['timeline']) {
    const sig = new RegExp(
      `async ${m}\\([\\s\\S]*?\\)\\s*\\{[\\s\\S]*?taskInstance\\.findFirst\\(\\s*\\{\\s*where:\\s*\\{\\s*id:\\s*taskId,\\s*tenantId\\s*\\}`,
    );
    assert.match(
      service,
      sig,
      `${m}() must guard with taskInstance.findFirst({where:{id, tenantId}}) → 404`,
    );
  }
});
