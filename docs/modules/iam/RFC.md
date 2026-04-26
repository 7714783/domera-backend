# Module RFC — `iam`

## 1. Why this module exists

User → Role → Permission → Scope mapping. ActorResolver assembles the runtime Actor object used by the policy engine on every protected request. Every other module reads through ActorResolver; only iam writes role assignments.

## 2. Scope and non-scope

### In scope
- BuildingRoleAssignment CRUD (assign, revoke).
- Staff creation + invite (createStaff).
- ActorResolver — pure DI service that returns `{ permissions, scope, mfaLevel, isSuperAdmin }`.
- Role catalogue management (read-only, seeded).

### Out of scope
- User auth + sessions — `auth` module.
- Role/permission seeding — `prisma/seeds/seed-reference.mjs`.
- TenantCompany admin promotion — `tenant-companies` module (writes `BuildingRoleAssignment.tenantCompanyId` scope).

## 3. Owned entities (writes)

| Model | Table | Notes |
|---|---|---|
| `BuildingRoleAssignment` | `building_role_assignments` | shared with `tenant-companies` (admin promotion), `auth` (initial bootstrap) |
| `OrganizationMembership` | `organization_memberships` | created in createStaff |
| `User` | `users` | shared with `auth` (registration) |

## 4. Reads (no writes)

| Model | Why |
|---|---|
| `Role`, `RolePermission` | seeded reference data |
| `Membership` | tenant-level grants |
| `Tenant` | scope |
| Cross-cutting: every module uses ActorResolver to read user permissions |

## 5. Incoming events

None today.

## 6. Outgoing events

None today (planned: `role.assigned` for audit + dashboard counters).

## 7. Workflow states

No workflow case. `BuildingRoleAssignment` is "active" if `expiresAt` is null or future.

## 8. Failure / rollback rules

- `assign` enforces `canDelegate(actor, target)` per role hierarchy.
- `assign` blocks self-promotion to higher roles.
- `createStaff` validates role exists, checks delegation rights.

## 9. Audit points

- `audit.write` on assign, revoke, createStaff (already wired).

## 10. RBAC + scope

| Endpoint | Permission | Scope |
|---|---|---|
| `POST /v1/buildings/:id/roles` | `role.assign` + canDelegate | building |
| `DELETE /v1/buildings/:id/roles/:assignmentId` | canDelegate | assignment |
| `GET /v1/buildings/:slug/staff` | `building.read` | building |

## 11. Tenant isolation

PrismaService + RLS on every assignment query.

## 12. DoR checklist

- [x] Backend endpoints exist
- [x] Frontend renders real data (team page + assignments matrix)
- [x] Tenant isolation enforced
- [x] RBAC enforced
- [x] audit.write wired
- [x] No cross-module direct writes (User shared with auth; documented)
- [x] State machine — N/A

## 13. Open questions

- ActorResolver caching — currently per-request; cross-request cache deferred until role-mutation rate justifies it.
