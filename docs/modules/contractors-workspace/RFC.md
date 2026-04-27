# Module RFC — `contractors-workspace`

## 1. Why this module exists

INIT-013. Per-workspace ↔ contractor link table. Each row stores PRIVATE relationship data (notes, agreed rate, local contact person, internal rating) that must NEVER leak cross-workspace. The public side of the same firm lives in `contractors-public`.

## 2. Scope and non-scope

### In scope
- Tenant-scoped CRUD on `WorkspaceContractor`
- Lifecycle: active → paused → terminated (soft-end)
- Audit on every create / update / unlink

### Out of scope
- Public registry mutations — see `contractors-public`
- Spending / invoice tracking — vendor-invoices module

## 3. Owned entities

| Model | Table | Notes |
|---|---|---|
| `WorkspaceContractor` | `workspace_contractors` | tenant-scoped, RLS enforced |

## 4. Tenant scope

Tenant-scoped via RLS (policy `tenant_isolation` on `workspace_contractors`).

## 5. Events emitted

`workspace_contractor.created`, `workspace_contractor.updated`, `workspace_contractor.terminated` — outbox-ready (not yet wired to handlers; consumed by audit only).

## 6. Permissions

`role.manage` for write; any authenticated workspace member can read.

## 7. Surface

- `GET /v1/workspace-contractors?status=&search=`
- `GET /v1/workspace-contractors/:id`
- `POST /v1/workspace-contractors`
- `PATCH /v1/workspace-contractors/:id`
- `DELETE /v1/workspace-contractors/:id` (soft-end)
