# Team & Roles (INIT-013)

> **Status:** Active. Effective 2026-04-27. Authoritative document for the people-domain modules.

## 1. Mental model

Three concepts, in order:

- **TeamMember** — a person who can be assigned to anything in a workspace. PPM tasks, cleaning requests, approvals, audit actors. **Every assignee MUST exist as a TeamMember.** Three kinds:
  - `employee` — has a `User` account in this workspace.
  - `contractor` — links to `WorkspaceContractor` (no User required).
  - `external` — ad-hoc human contact (auditor, vendor rep) without any link.
- **Role** — a named permission bag. System roles (24, immutable) + custom roles (per-tenant). Has `categories[]` (broad business domains the role exercises) and `permissions[]` (granular checks).
- **TeamMemberRoleAssignment** — `(member, role, ABAC scope)`. One member can hold N roles, each with its own scope (buildingIds / floorIds / zoneIds / systemIds / contractorCompanyId / tenantCompanyId / createdByScope / expiresAt).

## 2. Workspaces and isolation

- **One User, multiple Workspaces, one active at a time.** A user's `Membership` rows list every workspace they belong to. JWT carries identity (`sub`); the `x-tenant-id` header drives RLS.
- Switch with `POST /v1/auth/switch-workspace { tenantId }`. The endpoint:
  1. Validates the user has an active membership in the target tenant (super-admin bypasses).
  2. Revokes the current session.
  3. Mints a fresh JWT bound to the same userId.
  4. Frontend full-reloads to drop in-memory state.
- The old token can no longer read anything; cross-tab leakage is impossible.

## 3. Module categories

Every backend module under `apps/api/src/modules/<name>/` MUST export `MODULE_CATEGORY` from its `module.meta.ts`. Categories drive the role-builder UI grouping. Canonical list (single source: `apps/api/src/common/module-categories.ts`):

`finance · tech_support · legal · cleaning · security · compliance · operations · people · enterprise · mobile · platform`

CI gate `module-category-coverage.test.mjs` fails the build if any module folder is missing the meta file or uses a non-canonical category.

## 4. Public Contractor Registry

- `PublicContractor` — global, NOT tenant-scoped. Public-only fields (name, public phone/email, licenses, specialisations).
- `WorkspaceContractor` — per-workspace link. Stores PRIVATE state (notes, rate, internal rating, local contact person, contract dates).
- One `PublicContractor` row may be referenced by N `WorkspaceContractor` rows across N workspaces. Private side never leaks.
- Verification flag (`unverified` | `self_attested` | `platform_verified`) — only super-admin flips it.

## 5. Auto-routing resolver

`RoleAssignmentsService.findEligibleAssignees(tenantId, args)` is the load-bearing public API.

Args:
```ts
{
  requiredPermission: string;        // e.g. 'task.complete', 'cleaning.complete_soft_services'
  buildingId?: string;
  floorId?: string;
  zoneId?: string;
  systemId?: string;
  strategy?: 'first' | 'least_loaded' | 'round_robin'; // default: least_loaded
  openTaskLoad?: Record<string, number>; // member id → open-task count
}
```

Logic:
1. SELECT every active `TeamMemberRoleAssignment` where the joined `Role` has the required permission and the `TeamMember` is active.
2. Filter by ABAC scope intersection (empty array on the assignment = unrestricted within parent).
3. Deduplicate by member id (a member with multiple eligible roles appears once).
4. Sort by strategy.

Caller picks `pick = result[0]`. Empty result → leave the task `assignmentSource='unassigned'` and emit a notification (PPM does this in `scheduleExecution`).

## 6. Single-member rule

If the workspace has exactly one ACTIVE `TeamMember`, that member implicitly receives `workspace_owner` powers regardless of explicit role grants. Lets the very first user bootstrap the workspace without circular dependencies.

Implementation: `RoleAssignmentsService.canDelegate` returns `true` when `count(active members) === 1 && actor === sole member`. Permissions union from the audit endpoint already handles the read side.

## 7. Hard rules

1. **Every assignee MUST be a TeamMember.** PPM/Cleaning/Reactive endpoints accepting an assigneeId validate against `team_members` — passing a free-form `userId` returns 400.
2. **Custom role keys are namespaced** as `t_<tenantSlug>_<userKey>` to avoid collisions with system role keys.
3. **System roles (`tenantId IS NULL`, `isCustom=false`) are immutable** from the API. Workspace_owner can clone them.
4. **Custom roles can't be deleted while active grants exist.** Revoke first.
5. **Deactivating a TeamMember cascades** — every `TeamMemberRoleAssignment` is expired; row stays for audit history.
6. **Public contractor entries are dedup'd on phone OR email** at create time.
7. **No workspace_owner self-promotion** — `canDelegate` rejects targeting yourself with a higher-scope role (single-member exception aside).

## 8. Migration window

Legacy `BuildingRoleAssignment` and `iam.createStaff` paths are kept during the transition. Backfill (`017_backfill_team_members.sql`):

1. Materialises a `TeamMember` per `(tenantId, userId)` that has any `BuildingRoleAssignment`.
2. Merges per-(user, role, building) grants into a single `TeamMemberRoleAssignment` with `buildingIds[]`.
3. Sets `categories[]` defaults on each system role.

The `ssot-ownership.test.mjs` map allows iam to keep writing during this window. Once every consumer reads from the new tables, the legacy table will be dropped (separate INIT).

## 9. Surface

| Endpoint | Purpose |
|---|---|
| `GET/POST/PATCH /v1/public-contractors` | Global registry CRUD |
| `GET/POST/PATCH/DELETE /v1/workspace-contractors` | Per-workspace link CRUD |
| `GET/POST/PATCH/DELETE /v1/team` | TeamMember CRUD |
| `GET /v1/team/eligible?permission=&buildingId=&systemId=` | Auto-routing query |
| `GET/POST/PATCH/DELETE /v1/roles` + `POST /v1/roles/:key/clone` | Role catalogue |
| `GET/POST/PATCH/DELETE /v1/role-assignments` | Role grants |
| `POST /v1/auth/switch-workspace { tenantId }` | Workspace switch |

UI:

- `/admin/team` — list, search, filter by kind / inactive
- `/admin/team/[id]` — detail + active grants + deactivate
- `/admin/team/new` — add wizard
- `/admin/roles` — system + custom catalogue
- `/admin/roles/new` — role builder (categories + permissions)
- `/admin/roles/[key]` — role detail + clone + delete
- `/admin/role-assignments` — unified active grants list
- `/admin/contractors` — workspace + public registry side-by-side
