# Module RFC — `ppm`

## 1. Why this module exists

Preventive maintenance engine. Owns the calendar (RRULE schedules + Israeli blackouts), the templates (84 obligations seeded), and the case-by-case execution lifecycle (open → assigned → in_progress → check_passed/failed → approval_pending → contractor_execution → finance_confirmation → closed). Without PPM, every regulatory check is a calendar reminder in someone's head.

## 2. Scope and non-scope

### In scope
- PpmTemplate, PpmPlanItem, TaskInstance, PpmExecutionLog.
- RRULE-based scheduling with calendar-blackouts integration (Shabbat, Pesach, custom).
- Case state machine (8 main states + cancelled).
- Auto-creation from condition-triggers (via `createTaskFromTrigger` since INIT-010 P0-1).

### Out of scope
- Asset definition — owned by `assets` (PPM only attaches schedules).
- Approval workflow — owned by `approvals` (PPM raises ApprovalRequest for expense legs).
- Vendor management — owned by `organizations` + `contractor-companies`.

## 3. Owned entities (writes)

| Model | Table | Notes |
|---|---|---|
| `PpmTemplate` | `ppm_templates` | seeded + manager-edited |
| `PpmPlanItem` | `ppm_plan_items` | per-asset/system schedules |
| `TaskInstance` | `task_instances` | sole canonical creator (state ops live in `tasks`) |
| `PpmExecutionLog` | `ppm_execution_logs` | execution history per task |
| `CompletionRecord` | `completion_records` | shared owner with `reactive` + `imports` |

## 4. Reads (no writes)

| Model | Why | How |
|---|---|---|
| `Asset` | attach schedule + check evidence requirement | FK `PpmPlanItem.assetId` |
| `Building`, `BuildingFloor`, `BuildingSystem` | scoping schedules | FK chain |
| `CalendarBlackout` | shift `dueAt` past Shabbat/Pesach | tenant + building filter |
| `ApprovalRequest` | check approval landed before contractor_execution | FK `TaskInstance.approvalRequestId` |
| `Document` | resolve evidence on close | FK `TaskInstance.serviceReportDocumentId` |

## 5. Incoming events (subscriptions)

| Event | Producer | Effect |
|---|---|---|
| `condition.triggered` (planned) | condition-triggers | create TaskInstance for sensor-based corrective action |
| `approval.granted` | approvals | advance case to `approved` (currently via DI) |
| `approval.rejected` | approvals | advance case to `check_failed` |
| `completion.recorded` (planned) | reactive | close PPM case, link evidence |
| `invoice.paid` (planned) | reactive (finance) | move to `closed` financially |

## 6. Outgoing events (publications)

| Event | Schema | Payload | Consumers |
|---|---|---|---|
| `ppm.case.opened` | v1 | caseId, tenantId, buildingId, planItemId, openedBy | role-dashboards, audit |
| `ppm.check.completed` | v1 | caseId, tenantId, assetId, result, evidenceDocumentIds | assets, documents |
| `ppm.expense.requested` | v1 | caseId, tenantId, amount, currency, reason | approvals |
| `ppm.case.closed` | v1 | caseId, tenantId, assetId, finalStatus, evidenceDocumentIds | assets, documents, role-dashboards |

Runtime publish wiring lands in INIT-010 Phase 6.

## 7. Workflow states (state machine)

Full PPM case state machine declared in `state-machine.test.mjs` REGISTRY under `ppm_case`:

```
scheduled → opened → assigned → in_progress
in_progress → check_passed → closed                          (no extra cost)
in_progress → check_failed → approval_pending → approved
            → contractor_execution → finance_confirmation → closed
* → cancelled                                                (with reason)
```

Closing a case is forbidden when:
- `evidenceRequired = true` and no `serviceReportDocumentId` / `photoDocumentIds[]`.
- `executionMode in ('contractor', 'hybrid')` and an unpaid invoice exists.

## 8. Failure / rollback rules

- Approval rejection sends case to `check_failed` (allows re-opening with revised quote).
- Scheduler/blackout shift always pushes `dueAt` forward, never back.
- Cancellation requires a reason string; written to PpmExecutionLog + audit.

## 9. Audit points

- `audit.transition()` on every case state change (INIT-010 P0-3 wiring in progress; `reactive` + `cleaning` + `approvals` already wired).
- Module-specific `PpmExecutionLog` table is kept for domain detail; universal audit rows are the compliance surface.

## 10. RBAC + scope

| Endpoint | Permission | Scope |
|---|---|---|
| `GET /v1/buildings/:id/ppm/programs|executions|calendar` | `building.read` | building |
| `POST /v1/buildings/:id/ppm/programs` | `ppm.manage` | building |
| Case state transitions | role specific (`task.assign`, `task.complete_review`, `approval.approve_l1+`) | building + scope dimensions |

## 11. Tenant isolation

PrismaService auto-wraps every query with `set_config('app.current_tenant_id', …)`. RLS policy `app_current_tenant_id()` enforces at DB level. Cross-tenant join is structurally impossible.

## 12. DoR checklist

- [x] Backend endpoints exist and return real data
- [x] Frontend renders real data
- [x] Data persists; survives refresh
- [x] Tenant isolation enforced
- [x] RBAC enforced
- [x] Manual happy-path verified (PPM wizard → calendar → case → close)
- [x] State machine in REGISTRY (`ppm_case`)
- [x] Outgoing events declared in CATALOG
- [x] No cross-module direct writes (after INIT-010 P0-1 fix on condition-triggers)
- [x] No cross-module direct service imports without registered NestModule

## 13. Open questions

- Outbox-based event publish vs current DI integration with approvals — slated for INIT-010 Phase 7.
