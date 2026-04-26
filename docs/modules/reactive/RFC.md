# Module RFC — `reactive`

## 1. Why this module exists

Owns the unplanned-work pipeline: incidents, service-requests, work-orders, quotes, purchase-orders, completion-records. Every "something broke" or "vendor must come fix this" path lands here. Provides triage queue, SLA-aware sorting, manual-assign picker (INIT-004 Phase 6).

## 2. Scope and non-scope

### In scope
- Incident, ServiceRequest, WorkOrder, Quote, PurchaseOrder, CompletionRecord CRUD + lifecycle.
- Auto-assignment integration (calls `AssignmentResolverService` at create time).
- Manual reassignment endpoints (`/v1/incidents/:id/assign`, `/v1/service-requests/:id/assign`).
- Triage portfolio queue with SLA breach calculations.

### Out of scope
- Asset registry — read-only via FK.
- PPM scheduling — separate state machine (`ppm`).
- Approval engine — `approvals` module raises requests on demand.

## 3. Owned entities (writes)

| Model | Table | Notes |
|---|---|---|
| `Incident` | `incidents` | shared with `connectors` (inbound webhook path) |
| `ServiceRequest` | `service_requests` | shared with `public-qr` (anonymous QR submission) |
| `WorkOrder` | `work_orders` | sole owner |
| `Quote` | `quotes` | sole owner |
| `PurchaseOrder` | `purchase_orders` | sole owner |
| `CompletionRecord` | `completion_records` | shared with `ppm` + `imports` |

## 4. Reads (no writes)

| Model | Why | How |
|---|---|---|
| `Building`, `BuildingFloor`, `BuildingUnit` | resolve buildingId, derive floorId | FK lookup |
| `Asset` | (planned) link incident to asset | FK `Incident.equipmentId` |
| `ApprovalRequest` | gate WO completion when external work has PO | FK `Quote.approvalRequestId` |
| `Building` (display) | triage queue building names | tenant scope |

## 5. Incoming events (subscriptions)

| Event | Producer | Effect |
|---|---|---|
| `approval.granted` | approvals | advance Quote → approved; allow PO issuance |
| `approval.rejected` | approvals | advance Quote → rejected |
| `invoice.paid` (planned) | reactive (finance) | close work-order financially |

## 6. Outgoing events (publications)

| Event | Schema | Payload | Consumers |
|---|---|---|---|
| `workorder.dispatched` | v1 | workOrderId, tenantId, buildingId, vendorOrgId | role-dashboards |
| `completion.recorded` | v1 | completionId, tenantId, workOrderId, completedAt | ppm, assets, documents |
| `invoice.paid` | v1 | invoiceId, tenantId, amount, paidAt | ppm |

## 7. Workflow states

Three independent state machines in `state-machine.test.mjs` REGISTRY:

- `incident`: `new → triaged → dispatched → resolved → archived`
- `service_request`: same family
- `work_order`: `dispatched → in_progress → completed`

`Quote` and `PurchaseOrder` have small terminal-driven state sets (received/approved/rejected/superseded; issued/in_progress/completed).

## 8. Failure / rollback rules

- `recordCompletion` blocks when external work with PO has no evidence.
- `issuePurchaseOrder` blocks when PO issuer == quote requester (Separation of Duties).
- Quote `revisionOf` flips the prior to `superseded` — preserves audit trail.

## 9. Audit points

`audit.transition()` wired (INIT-010 P0-3, 2026-04-26) on:
- `createIncident`, `ackIncident`, `resolveIncident`, `assignIncident`
- `createServiceRequest`, `resolveServiceRequest`, `assignServiceRequest`
- `convertToWorkOrder` (publishes WorkOrder + Incident/SR transitions)

Pending: `createQuote`, `issuePurchaseOrder`, `recordCompletion` — P1 follow-up.

## 10. RBAC + scope

| Endpoint | Permission | Scope |
|---|---|---|
| `GET /v1/triage` | `task.assign` / `tasks.view_all` / `security.incident.manage` | tenant + scope narrows via ActorResolver |
| `POST /v1/buildings/:id/incidents` | open to authenticated; `requireManager` for ack/resolve | buildingId derived |
| `POST /v1/incidents/:id/assign` | `requireManager` (incl. maintenance_coordinator, finance_controller) | building |
| `GET /v1/buildings/:id/incidents`, `/service-requests` | building.read; ActorResolver applies createdByScope/tenantCompanyId narrows | INIT-007 Phase 4 |

## 11. Tenant isolation

PrismaService + RLS. ActorResolver applies per-row narrows for tenantCompanyId / createdByScope where role policy demands.

## 12. DoR checklist

- [x] Backend endpoints exist and return real data
- [x] Frontend renders real data (triage page, manager-queue picker)
- [x] Data persists; survives refresh
- [x] Tenant isolation enforced
- [x] RBAC enforced
- [x] Manual happy-path verified (create incident → triage → assign → resolve)
- [x] State machine in REGISTRY (`incident`, `service_request`, `work_order`, `quote`)
- [x] Outgoing events declared in CATALOG
- [x] No cross-module direct writes (Incident shared owner with connectors documented; CompletionRecord shared with ppm/imports documented)
- [x] No cross-module direct service imports without registered NestModule

## 13. Open questions

- Quote/PO/Completion audit.transition wiring — pending follow-up (P1).
- Automated SLA-breach notification → push event for triage UI — backlog item.
