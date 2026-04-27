# Module RFC — `role-assignments`

## 1. Why this module exists

INIT-013. Owns `TeamMemberRoleAssignment` (the primary role-grant table going forward) and exposes the **auto-routing resolver** consumed by PPM / Cleaning / Reactive: `findEligibleAssignees(taskKind, contextScope)` returns members whose role-permissions cover the task and whose ABAC scope intersects the context.

Replaces the legacy `BuildingRoleAssignment` for new code. The legacy table stays as a read fallback during migration (both are kept in sync by `iam.service.ts` writes; backfilled by `017_backfill_team_members.sql`).

## 2. Scope and non-scope

### In scope
- Assign / scope-edit / revoke role grants
- `canDelegate` check (mirrors IamService logic, reads from new table)
- `findEligibleAssignees` — used by PPM / Cleaning / Reactive for auto-routing
- Single-member-rule fallback (workspace bootstrap)

### Out of scope
- Role catalogue mutations — see `roles`
- TeamMember CRUD — see `team`
- Approval workflow for delegating high-scope roles — separate INIT (later phase)

## 3. Owned entities

| Model | Table | Notes |
|---|---|---|
| `TeamMemberRoleAssignment` | `team_member_role_assignments` | tenant-scoped, RLS enforced |

## 4. Tenant scope

Tenant-scoped via RLS.

## 5. Events emitted

`role.assigned`, `role.scope_updated`, `role.revoked` — audit-stamped (sensitive=true). Outbox ready, not yet wired.

## 6. Permissions

`role.assign` or `role.assign_scoped` (per-building) for write. Read: any authenticated workspace member.

## 7. Surface

- `GET /v1/role-assignments?teamMemberId=&roleKey=&activeOnly=`
- `POST /v1/role-assignments` body `{ teamMemberId, roleKey, buildingIds[], floorIds[], zoneIds[], systemIds[], expiresAt }`
- `PATCH /v1/role-assignments/:id`
- `DELETE /v1/role-assignments/:id`

Internal service API: `findEligibleAssignees(tenantId, { requiredPermission, buildingId, floorId, zoneId, systemId, strategy, openTaskLoad })`.
