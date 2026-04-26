# Platform Development Contract — universal rules for every module

> **Status:** binding. **Effective:** 2026-04-26. **Owner:** architecture.
>
> This document is the law. Every module — existing or new — follows it.
> Violations are caught by CI gates documented at the end.
> Не "договорились" — а "проходит через CI или PR не сливается".
>
> Companion documents:
> - [entity-ownership-ssot.md](entity-ownership-ssot.md) — who writes what.
> - [modules-inventory-2026-04-26.md](modules-inventory-2026-04-26.md) — current state of all modules.
> - [docs/modules/_template/RFC.md](../modules/_template/RFC.md) — template every new module copies.

## 1. One canonical entity, one owner

For every business entity (Asset, BuildingFloor, FloorAssignment, Incident, …):

- **Exactly one Prisma model** represents it. Synonyms are a code smell.
- **Exactly one module owns writes** (`create / update / upsert / delete / *Many`).
- All other modules **read** by id or FK.
- Cross-module mutations happen via **commands or events**, never via direct `prisma.<model>.update()`.

Enforced by [test/ssot-ownership.test.mjs](../../apps/api/test/ssot-ownership.test.mjs). Allow-list is in the test file; changes to it require an architecture-owner review (see CODEOWNERS).

## 2. State machines — explicit, exhaustive, tested

Every workflow has a typed state machine. **No string `status` checked ad-hoc inside a service.**

### Mandatory parts of any state machine

| Part | What it provides |
|---|---|
| `STATES` | enumerated string-literal union |
| `TRANSITIONS` | const map `{ from: { to: 'allowed' \| 'blocked' } }` with a one-line **reason** comment |
| `transition(from, to)` | single function — throws `InvalidTransitionError` on a forbidden hop |
| Per-transition **guards** | preconditions (`evidenceRequired`, `approvalLanded`, `paymentConfirmed`, …) checked in one place |
| Audit hook | every transition writes one `audit_entries` row |

### Canonical workflows

The full list lives in [state-machines.md](state-machines.md). A short summary:

| Workflow | States |
|---|---|
| **PPM case (full)** | `scheduled → opened → assigned → in_progress → check_passed \| check_failed → (if expense) approval_pending → approved → contractor_execution → finance_confirmation → closed` |
| **Cleaning request (short)** | `qr_scan → new → assigned → in_progress → done → resident_notified` |
| **Incident (reactive)** | `new → triaged → dispatched → resolved → archived` |
| **Service request** | `new → triaged → dispatched → resolved → archived` |
| **Approval request** | `pending → approved \| rejected → fulfilled` |
| **Quote** | `received → approved \| rejected → superseded` |
| **WorkOrder** | `dispatched → in_progress → completed` |
| **CompletionRecord** | `recorded` (terminal — append-only) |

Closing a case is **forbidden** when:
- mandatory documents are missing (`evidenceRequired = true` and no `serviceReportDocumentId` / `photoDocumentIds[]`)
- mandatory approval steps are not landed (`approvalRequestId` is unresolved)
- payment is not confirmed when `executionMode in ('contractor', 'hybrid')` and an invoice exists

Enforced by [test/state-machine.test.mjs](../../apps/api/test/state-machine.test.mjs).

## 3. Module ownership matrix

### Ownership rules (single source of truth = SSOT)

```
Module Y wants to update entity X
  ├── Module Y owns X         → direct prisma call (allowed)
  ├── Module Y subscribes to X-events  → upsert into Y's read-model only
  └── Module Y wants X mutated → publish a command to X-owner; never write directly
```

### Domain ownership

```
Assets module
  ├─ owns: Asset, AssetType, AssetCustomAttribute, AssetDocument, AssetMedia, AssetSparePart
  ├─ reads from: BuildingLocation (via locationId)
  └─ publishes: asset.created, asset.updated, asset.maintenance_recorded

PPM module
  ├─ owns: PpmProgram, PpmPlanItem, TaskInstance, PpmExecutionLog, PpmCase
  ├─ reads from: Asset, BuildingFloor, BuildingSystem, ContractorCompany
  ├─ subscribes to: asset.created (auto-suggest PPM templates)
  └─ publishes: ppm.case.opened, ppm.check.completed, ppm.expense.requested,
                ppm.expense.approved, ppm.case.closed

Approvals module
  ├─ owns: ApprovalPolicy, ApprovalRequest, ApprovalStep, ApprovalDelegation
  ├─ subscribes to: ppm.expense.requested (creates ApprovalRequest)
  └─ publishes: approval.granted, approval.rejected

Reactive (Incidents/SR/WO/Quote/PO/Completion) module
  ├─ owns: Incident, ServiceRequest, WorkOrder, Quote, PurchaseOrder, CompletionRecord
  ├─ subscribes to: ppm.expense.approved (creates WorkOrder + Quote)
  ├─ subscribes to: invoice.paid (advances case to financially_closed)
  └─ publishes: workorder.dispatched, completion.recorded, invoice.issued

Cleaning module
  ├─ owns: CleaningRequest, CleaningZone, CleaningContractor, CleaningStaff, CleaningRole,
           CleaningRequestComment, CleaningRequestHistory, CleaningRequestAttachment
  └─ publishes: cleaning.request.created, cleaning.request.completed

Documents module
  ├─ owns: Document, DocumentLink, DocumentTemplate
  ├─ subscribes to: ppm.case.closed (auto-link evidence via documentId)
  └─ no direct cross-module writes

IAM / Auth / authz
  ├─ owns: User, Membership, BuildingRoleAssignment, Role, RolePermission
  └─ every other module reads via ActorResolver (per-request)

Audit
  ├─ owns: AuditEntry (the ONLY module writing prisma.auditEntry directly)
  └─ every other module writes via audit.write()
```

This matrix is enforced by [test/ssot-ownership.test.mjs](../../apps/api/test/ssot-ownership.test.mjs) + [test/module-boundaries.test.mjs](../../apps/api/test/module-boundaries.test.mjs).

## 4. Events catalog (outbox + runners)

Cross-module synchronisation happens through events written to an **outbox** within the same Prisma transaction as the state change. A worker fans them out to subscribers.

### Event envelope

```ts
{
  id: uuid,                 // event id
  tenantId: string,         // RLS-scoped
  type: string,             // e.g. ppm.case.closed
  schemaVersion: 1,         // bumps on breaking change
  occurredAt: ISO timestamp,
  actor: { userId, role },  // who caused this
  payload: { … },           // typed per schemaVersion
  causationId?: string,     // event id that caused this
  correlationId?: string,   // case/work-order id glue
}
```

### Event catalog

| Event type | Producer | Consumers | Effect |
|---|---|---|---|
| `asset.created` | assets | ppm | suggest PPM templates from asset type |
| `asset.updated` | assets | role-dashboards | invalidate read-models |
| `ppm.case.opened` | ppm | role-dashboards, audit | KPI counter |
| `ppm.check.completed` | ppm | assets, documents | append maintenance record + link evidence |
| `ppm.expense.requested` | ppm | approvals | create ApprovalRequest |
| `approval.granted` | approvals | ppm, reactive | advance case to `approved` |
| `approval.rejected` | approvals | ppm | advance case to `check_failed` |
| `workorder.dispatched` | reactive | role-dashboards | KPI counter |
| `completion.recorded` | reactive | ppm, assets, documents | close PPM case + asset timeline + evidence |
| `invoice.paid` | reactive (finance) | ppm | advance case to `financially_closed` |
| `cleaning.request.created` | cleaning | role-dashboards, push-notifications | manager queue + push |
| `cleaning.request.completed` | cleaning | push-notifications | resident push |
| `floor_assignment.changed` | assignment | reactive | invalidate auto-resolver cache |

Enforced by [test/event-contract.test.mjs](../../apps/api/test/event-contract.test.mjs).

## 5. Tenant isolation + RBAC + audit (every module, no exceptions)

| Rule | How it's enforced |
|---|---|
| Every tenant-scoped table has `tenantId` + RLS policy `tenantId = app_current_tenant_id()` | [test/rls.migration.test.mjs](../../apps/api/test/rls.migration.test.mjs) |
| Every controller for tenant-scoped routes goes through `TenantMiddleware` (auth required) | [test/locations.contract.mjs](../../apps/api/test/locations.contract.mjs) catches no-auth case |
| Every write that mutates a sensitive entity calls `audit.write()` | grep guard — `test/audit-coverage.test.mjs` (planned) |
| Every role × endpoint combo has a documented expected status | [test/rbac-matrix.test.mjs](../../apps/api/test/rbac-matrix.test.mjs) |
| Every list endpoint applies `ActorResolver` scope narrows (createdByScope, tenantCompanyId, contractorCompanyId) when relevant | [test/authz-policy.test.mjs](../../apps/api/test/authz-policy.test.mjs) |

## 6. Idempotency + queues

- Every mutating endpoint accepts an optional `Idempotency-Key` header.
- Re-issuing a write with the same key returns the original response (no duplicate side-effects).
- Async transitions (event handlers, runner jobs) only run via BullMQ — never inline in the request handler.
- Failure handling: at-least-once delivery + idempotent handlers. Poison messages → DLQ + alert.

## 7. Definition of Ready (DoR) — module level

A module is 🟢 ready only when ALL of these are true:

1. Backend endpoint(s) exist + return real data.
2. Frontend renders that real data (no mock arrays in production UI).
3. Data persists in the DB (write endpoint exists + UI calls it).
4. Data still visible after page refresh.
5. Tenant isolation enforced (RLS or `where: { tenantId }`).
6. RBAC enforced (`requireManager` / `authorize` / scope check).
7. Manual happy-path verified.
8. **State machine in place + tested** (this file's §2).
9. **Outgoing events declared in event catalog + schema-tested** (this file's §4).
10. **Cross-module writes go through events, not direct Prisma calls** (this file's §3).
11. **Module RFC exists** at `docs/modules/<name>/RFC.md` with all required sections.

Items 1–7 inherited from the modules-inventory DoR; 8–11 added by this contract.

## 8. PR template — mandatory checklist

Every PR (regardless of size) ticks:

```
- [ ] Ownership matrix unchanged, OR docs/architecture/entity-ownership-ssot.md updated
      AND test/ssot-ownership.test.mjs OWNERSHIP map updated.
- [ ] State machine — no new statuses introduced, OR added to test/state-machine.test.mjs
      with explicit allowed transitions + guard reasons.
- [ ] Events — no new event types, OR added to test/event-contract.test.mjs catalog
      with payload schema + producer/consumer wiring.
- [ ] Cross-module writes — none, OR documented as command/event + handler test.
- [ ] Audit — every sensitive write calls audit.write() with full metadata.
- [ ] Tenant isolation — every new query has `where: { tenantId }` OR is read from a
      tenant-context view.
- [ ] RBAC — controller method either calls `requireManager`/`authorize` or
      explicitly bypasses with a comment explaining why.
- [ ] If a new module: docs/modules/<name>/RFC.md added (template at docs/modules/_template/RFC.md).
- [ ] If a new entity: row added to ownership matrix in entity-ownership-ssot.md.
- [ ] Manual happy-path test recipe in PR description — what was clicked, what saved,
      what survived refresh.
```

Lives at [.github/pull_request_template.md](../../.github/pull_request_template.md). GitHub renders it on every new PR.

## 9. CI gates (block merge)

The contract is enforced by these CI tests. **None of them is optional.**

| Gate | What it catches |
|---|---|
| `prisma-validate` | schema issues, RLS naming drift (`current_setting('app.tenant_id'`) |
| `ssot-ownership.test.mjs` | cross-module direct writes |
| `module-boundaries.test.mjs` | cross-module imports of internal services |
| `state-machine.test.mjs` | undeclared transitions, missing guards |
| `event-contract.test.mjs` | events without schema, payload drift |
| `rbac-matrix.test.mjs` | role-permission drift |
| `rls.migration.test.mjs` | new tenant-scoped tables without RLS |
| `authz-policy.test.mjs` | scope semantics of policy.ts |
| `assignment-resolver.test.mjs` | INIT-004 resolver chain |
| `locations.contract.mjs` (nightly) | endpoint contract on PROD |
| `module-rfc.test.mjs` | new module folder without docs/modules/<name>/RFC.md |

When any gate fails, the merge is blocked. Period.

## 10. Architecture review + CODEOWNERS

Architecture-sensitive paths require a review from the architecture owner before merge:

```
apps/api/src/modules/**         @architecture
apps/api/src/common/authz/**    @architecture
apps/api/prisma/**              @architecture
docs/architecture/**            @architecture
docs/modules/**                 @architecture
.github/workflows/**            @architecture
```

See [.github/CODEOWNERS](../../.github/CODEOWNERS).

## 11. New module checklist (developer-facing)

When starting a new module:

1. Run `node scripts/new-module.mjs <name>` — scaffolds:
   - `apps/api/src/modules/<name>/<name>.{module,service,controller}.ts`
   - `docs/modules/<name>/RFC.md` (copy of `_template`)
   - row in `apps/api/test/ssot-ownership.test.mjs` OWNERSHIP map (commented out — un-comment when first entity lands)
   - row in `apps/api/test/state-machine.test.mjs` REGISTRY (commented out)
   - row in `apps/api/test/event-contract.test.mjs` CATALOG (commented out)
2. Fill in the RFC sections — owner entities, reads/writes, events in/out, states, failure rules, audit points.
3. Build the module against the RFC.
4. PR: every checklist item ticked + RFC delta in the PR description.
5. CI gates pass.
6. Architecture owner approves.
7. Merge.

If a step is skipped, CI fails and the PR is blocked.

## 12. Architecture drift weekly review

Saturday 03:00 UTC, an automated job:

1. Lists every module that mutates an entity it doesn't own (should be 0).
2. Lists every module without a state machine entry / event catalog entry / RFC (should be 0).
3. Posts a Markdown report to `docs/architecture/drift-reports/YYYY-WW.md`.

If non-zero, surfaces in the developer dashboard `Operability` row as 🟡 partial until cleaned up.

Workflow: `.github/workflows/architecture-drift.yml` (planned).

## 13. What this contract does NOT cover (intentional)

- **UI redesign cadence** — covered by product-design docs.
- **Performance budgets per endpoint** — covered by `metrics` module SLOs.
- **Mobile app architecture** — has its own `docs/architecture/mobile-app-architecture.md`.

## 14. Updating this contract

This file is the law. To change it:

1. Open a PR that edits both this file AND every test file that the change affects.
2. Architecture owner approves.
3. CI green (because every gate now reflects the new rule).
4. Merge.

The contract evolves; the enforcement never lags behind it.
