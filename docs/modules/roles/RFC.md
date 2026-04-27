# Module RFC — `roles`

## 1. Why this module exists

INIT-013. Owns the `Role` catalogue (system + tenant-custom) and the permission/category metadata that the role-builder UI uses. Lets a workspace_owner create a custom role ("Программист BMS"), pick categories (`tech_support`, `compliance`), pick permissions within those categories, optionally clone from a system role as a starting point.

System roles (24 of them) are immutable from the API: workspace_owner can READ + CLONE, never edit / delete. Custom roles are tenant-scoped and the unique `key` is namespaced (`t_<tenantSlug>_<userKey>`) to avoid collisions with the global catalogue.

## 2. Scope and non-scope

### In scope
- List roles visible to a tenant (system union with tenant-custom)
- Create / update / delete custom roles
- Clone a system or custom role
- Permission replacement on update (transactional)
- Category validation against the canonical `MODULE_CATEGORIES` list

### Out of scope
- Role grants — `role-assignments`
- Permission seeding / system role catalogue — `prisma/seeds/seed-reference.mjs`
- ABAC scope editing — `role-assignments`

## 3. Owned entities

| Model | Table | Notes |
|---|---|---|
| `Role` | `roles` | system rows are tenantId IS NULL; custom rows tenantId = self |
| `RolePermission` | `role_permissions` | replaced wholesale on role update |

## 4. Tenant scope

Mixed:
- System rows are global and read-only via the API.
- Custom rows are tenant-scoped via the `tenantId` column.

No RLS on `roles` (so global rows are visible). Application layer guards every write to enforce `r.tenantId === actorTenantId && r.isCustom`.

## 5. Events emitted

`role.created`, `role.updated`, `role.deleted` — audit only for v1.

## 6. Permissions

`role.manage` for write. Read: any authenticated workspace member.

## 7. Surface

- `GET /v1/roles`
- `GET /v1/roles/:key`
- `POST /v1/roles`
- `POST /v1/roles/:key/clone` body `{ name }`
- `PATCH /v1/roles/:key`
- `DELETE /v1/roles/:key` (only if no active grants)
