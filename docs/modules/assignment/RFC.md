# Module RFC — `assignment`

## 1. Why this module exists

INIT-004 auto-assignment chain. Maps "incoming request on floor X needing role Y" → "user Z". Owns FloorAssignment (matrix) + UserAvailability (today's absences).

## 2. Scope / non-scope

**In:** FloorAssignment + UserAvailability CRUD; pure-function `resolveAssignment(prisma, input)` consumed by reactive + public-qr; CRUD endpoints for the team-assignments UI matrix.
**Out:** the actual request creation (reactive/public-qr/cleaning).

## 3. Owned entities

| Model | Table |
|---|---|
| `FloorAssignment` | `floor_assignments` |
| `UserAvailability` | `user_availability` |

## 4. Reads
- `BuildingRoleAssignment` — backup-fallback step in resolver.
- `BuildingFloor` — for matrix rendering only.

## 5. Incoming events
None today. Planned: `floor_assignment.changed` → its own consumers (resolver cache invalidation in reactive).

## 6. Outgoing events

| Event | Payload | Consumers |
|---|---|---|
| `floor_assignment.changed` v1 | floorId, tenantId, changeType, roleKey | reactive |

## 7. Workflow states

No workflow case. `UserAvailability.status` is enumerated (`available|off|leave|sick|absent|unavailable`) but each row is independent — no transitions.

## 8. Failure / rollback

- Resolver returns `{userId: null, source: 'manager_queue'}` if no candidate — never throws; caller routes manually.
- `setAvailability` allows self-set OR requireManager.
- Primary FloorAssignment uniqueness enforced via demote-then-create flow.

## 9. Audit
- (Planned) audit on FloorAssignment create/delete — backlog P2.

## 10. RBAC

| Endpoint | Permission |
|---|---|
| `GET/POST /v1/buildings/:id/floor-assignments` | requireManager(buildingId) |
| `DELETE /v1/floor-assignments/:id` | requireManager |
| `GET/POST /v1/user-availability` | self OR requireManager |

## 11. Tenant isolation
PrismaService + RLS via `app_current_tenant_id()` (migration 012 sets policy).

## 12. DoR
- [x] Backend + frontend (matrix + availability page)
- [x] Tenant + RBAC enforced
- [x] No cross-module writes
- [x] 7/7 resolver unit tests pass

## 13. Open questions
- Outbox publish for `floor_assignment.changed` — INIT-010 Phase 6.
- Bridge to CleaningStaff (INIT-009 Phase 3).
