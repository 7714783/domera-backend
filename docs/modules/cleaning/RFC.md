# Module RFC — `cleaning`

## 1. Why this module exists

Operates the cleaning vertical end-to-end: zones, contractors, staff hierarchy (boss/manager/supervisor/cleaner), QR-driven public submissions, request lifecycle. Separate from the core User/Role catalogue because cleaning contractors run their own internal hierarchy that the platform respects but does not override.

## 2. Scope and non-scope

### In scope
- CleaningRequest, CleaningZone, CleaningContractor, CleaningStaff, CleaningRole CRUD.
- CleaningQrPoint (per-zone QR labels) + public submit path.
- Request history (`CleaningRequestHistory`) — domain log for cleaning-specific timeline.
- Comments + attachments on requests.

### Out of scope
- Assignment to platform Users — separate hierarchy (CleaningStaff has optional `userId`); INIT-009 will bridge cleaning into the unified Tasks inbox.
- Tenant-tasks-inbox aggregation.
- Floor / building modelling.

## 3. Owned entities (writes)

| Model | Table |
|---|---|
| `CleaningRequest` | `cleaning_requests` |
| `CleaningRequestComment` | `cleaning_request_comments` |
| `CleaningRequestHistory` | `cleaning_request_history` |
| `CleaningRequestAttachment` | `cleaning_request_attachments` |
| `CleaningZone` | `cleaning_zones` |
| `CleaningContractor` | `cleaning_contractors` |
| `CleaningStaff` | `cleaning_staff` |
| `CleaningRole` | `cleaning_roles` |
| `CleaningQrPoint` | `cleaning_qr_points` |

## 4. Reads (no writes)

| Model | Why |
|---|---|
| `Building`, `BuildingFloor` | resolve buildingId / floor scope |
| `User` | check actor membership |
| `BuildingRoleAssignment` | actor.kind resolution + scope-narrow filters |

## 5. Incoming events

None today. INIT-010 Phase 6 will add subscription to `floor_assignment.changed` (drop in cleaner availability cache).

## 6. Outgoing events

| Event | Payload | Consumers |
|---|---|---|
| `cleaning.request.created` v1 | requestId, tenantId, buildingId, zoneId, source | role-dashboards |
| `cleaning.request.completed` v1 | requestId, tenantId, completedBy, completedAt | (none today; resident push planned) |

Runtime publish wiring: INIT-010 Phase 6.

## 7. Workflow states

`cleaning_request` REGISTRY entry:

```
new → assigned → in_progress → done   (canonical path)
new → cancelled / rejected             (terminal short-circuits)
```

`changeStatus` enforces `canChangeStatus(actor.kind, from, to)` per role.

## 8. Failure / rollback rules

- `assign` rejects when contractor doesn't match staff.contractorId (cross-contractor block).
- Status transitions limited per role (cleaner can only `assigned → in_progress` and `in_progress → done`).
- Public QR submit uses `MigratorPrismaService` because no tenant context exists; tenantId hard-derived from QR resolver.

## 9. Audit points

- `audit.transition()` on `changeStatus` (INIT-010 P0-3, 2026-04-26).
- Module-specific `cleaning_request_history` rows preserved as domain detail.
- CRUD on contractors/staff/zones — manager-gated; module-history captured but no universal audit yet (P2 follow-up).

## 10. RBAC + scope

| Endpoint | Permission | Scope |
|---|---|---|
| `GET /v1/cleaning/requests` | building.read; ActorResolver narrows | INIT-007 Phase 4 |
| `POST /v1/cleaning/requests` | platform_admin / building_manager / cleaning_manager | building |
| `PATCH /v1/cleaning/requests/:id/status` | role-bound transitions (`canChangeStatus`) | building/zone/staff |
| Public `POST /v1/public/cleaning/qr/:code/request` | no-auth (BYPASS_PATHS); rate-limited | tenant via QR resolver |

## 11. Tenant isolation

Internal endpoints — PrismaService + RLS. Public submit uses MigratorPrismaService (BYPASSRLS) with explicit `where: { tenantId: qr.tenantId }` clause.

## 12. DoR checklist

- [x] Backend endpoints exist
- [x] Frontend renders real data (cleaning building dashboard + portfolio + QR form)
- [x] Data persists; survives refresh
- [x] Tenant isolation enforced
- [x] RBAC enforced (per-role transitions + manager gates)
- [x] Manual happy-path verified (QR submit → cleaner sees → in_progress → done)
- [x] State machine in REGISTRY
- [x] Outgoing events declared in CATALOG
- [x] No cross-module direct writes
- [x] No cross-module direct service imports without registered NestModule

Status overall: 🟡 partial — gated on INIT-009 (Unified Tasks Inbox) for full operational integration.

## 13. Open questions

- CleaningStaff↔User bridge for unified task inbox — INIT-009 Phase 3.
- Outbox publish for `cleaning.request.completed` (resident push notification) — INIT-010 Phase 6.
