# Module RFC — `team`

## 1. Why this module exists

INIT-013. Single source of "people who can be assigned to anything in this workspace". Every PPM-task assignee, every cleaning request approver, every audit actor MUST exist as a `TeamMember`. Modules that previously read `User` directly for assignee selection now read `TeamMember`.

Two kinds:
- `employee` — has a `User` account in this workspace
- `contractor` — links to `WorkspaceContractor` (no User required)
- `external` — ad-hoc human contact (auditor, vendor rep)

## 2. Scope and non-scope

### In scope
- CRUD on `TeamMember`
- Deactivate cascade — auto-revokes all role assignments (`TeamMemberRoleAssignment`) on deactivation
- Single-member rule helper (`isSoleActiveMember`) — used by other modules to decide whether implicit workspace_owner powers apply

### Out of scope
- Role grants / scope editing — see `role-assignments`
- User account lifecycle (login, password reset, MFA) — `auth` module
- Public contractor catalogue — see `contractors-public`

## 3. Owned entities

| Model | Table | Notes |
|---|---|---|
| `TeamMember` | `team_members` | tenant-scoped, RLS enforced |

(legacy `iam.createStaff` is allowed during the migration window — listed as a transitional dual-writer in `ssot-ownership.test.mjs`)

## 4. Tenant scope

Tenant-scoped via RLS. `(tenantId, userId)` is unique to enforce one TeamMember per User per workspace.

## 5. Events emitted

`team_member.created`, `team_member.updated`, `team_member.deactivated` (transition event with sensitive=true). Audit only for v1.

## 6. Permissions

`role.manage` to write. Any authenticated workspace member can read.

## 7. Surface

- `GET /v1/team?search=&kind=&activeOnly=`
- `GET /v1/team/:id`
- `POST /v1/team`
- `PATCH /v1/team/:id`
- `DELETE /v1/team/:id` (deactivate)
