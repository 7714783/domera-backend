# Module RFC — `tasks`

## 1. Why this module exists

Owns the **mobile-facing task lifecycle**. PPM creates a `TaskInstance` row when a plan item is scheduled (or condition-trigger fires); this module then owns the state machine that the technician drives from the mobile app:

`scheduled → in_progress → paused → resumed → completed (with evidence)` plus notes stream and `Unified Tasks Inbox` aggregator across PPM + Cleaning + Reactive (INIT-009).

PPM is the **creator**; tasks is the **operator** of the state machine. Both are listed as legitimate writers in `ssot-ownership.test.mjs` (`taskInstance: ['ppm', 'tasks', 'seed-runtime']`).

## 2. Scope and non-scope

### In scope
- Task lifecycle endpoints: start / pause / resume / complete (`/v1/tasks/:id/<verb>`).
- Notes stream (`POST /v1/tasks/:id/notes`).
- Unified inbox (`GET /v1/tasks/inbox`) — unions PPM `TaskInstance` + Cleaning `CleaningRequest` + Reactive `Incident` + `ServiceRequest` filtered to the caller's role grants.
- Evidence-required gate at completion — refuses to complete if the underlying plan item demands evidence and `evidenceDocuments[]` is empty.
- `audit.transition` on every state change.
- Idempotent re-completes (returns the existing record).

### Out of scope
- Task creation (`PPM` does that from a plan item or condition-trigger).
- Auto-assignment / routing — `role-assignments.findEligibleAssignees` resolver, called by PPM at creation time.
- Reminders / notifications — `notifications` module subscribes to `task.assigned` / `task.due_soon` events.
- Cleaning request lifecycle — `cleaning` module owns its own state machine (separate from this).

## 3. Owned entities

| Model | Table | Notes |
|---|---|---|
| `TaskInstance` | `task_instances` | created by `ppm` / `seed-runtime`; lifecycle owned here |
| `TaskNote` | `task_notes` | INIT-002 P5 |

## 4. Tenant scope

Tenant-scoped via RLS. `TaskInstance` carries `tenantId + buildingId`.

## 5. Events

### Subscribed
None — this module is the controller side.

### Published
`task.assigned` (when PPM/auto-router hits a member), `task.started`, `task.paused`, `task.completed`, `task.due_soon` (cron from PPM SLA worker — Phase 2 will route through this module).

## 6. Permissions

- `task.read_assigned` — technician sees their queue.
- `task.complete` — technician completes (evidence gate enforced).
- `task.complete_review` — chief engineer / manager reviews.
- `task.assign` / `task.reassign` — manager / dispatcher.
- `tasks.view_all` — building manager / auditor.
- `tasks.view_company` — tenant_company_admin.
- `tasks.view_created` — external_engineer / reception.

## 7. Surface

- `GET /v1/tasks` — building/status/assignee filters.
- `GET /v1/tasks/inbox?kind=ppm|cleaning|incident|service_request|all` — INIT-009.
- `GET /v1/tasks/:id`.
- `POST /v1/tasks/:id/{start, pause, resume, complete}`.
- `GET / POST /v1/tasks/:id/notes`.

## 8. Hard rules

1. Lifecycle transitions are recorded via `audit.transition` (sensitive only when policy says so — `complete` of an evidence-required task is sensitive=true).
2. Re-completion of an already-completed task returns the existing payload; never duplicates.
3. Notes are append-only — no edit / delete in v1.
4. The inbox is **read-only union**: state changes still happen on each module's canonical endpoint via `item.sourceUrl`.
