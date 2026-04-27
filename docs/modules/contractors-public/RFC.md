# Module RFC — `contractors-public`

## 1. Why this module exists

INIT-013 Roles & Team. Holds a single global registry of contractor firms (`PublicContractor`) so the same physical firm can be referenced by multiple workspaces without duplicating its public phone / email / licenses. Workspaces link to entries via `WorkspaceContractor` (separate module).

## 2. Scope and non-scope

### In scope
- CRUD on the global `PublicContractor` table
- Soft dedup on phone/email at create time
- Search endpoint used by workspace_owners when adding a contractor for the first time

### Out of scope
- Per-workspace state (private notes, rate, internal rating) — lives in `contractors-workspace`
- Verification / trust badge flipping — handled by super-admin tooling, not exposed here
- Marketplace-style reviews / browse — separate INIT

## 3. Owned entities (writes)

| Model | Table | Notes |
|---|---|---|
| `PublicContractor` | `public_contractors` | global, NOT tenant-scoped |

## 4. Tenant scope

Module is **global**: no `tenantId` column on `public_contractors`. Anyone authenticated may write (create flow: workspace_owner adding a new firm). Verification flag is super-admin only.

## 5. Events emitted

None for v1 — writes are local. Future: emit `public_contractor.verified` when verification flips, for cross-tenant cache invalidation.

## 6. Permissions

Read: any authenticated user. Write: any authenticated user (audit-stamped with createdByTenantId).

## 7. Surface

- `GET /v1/public-contractors?search=…&limit=…`
- `GET /v1/public-contractors/:id`
- `POST /v1/public-contractors`
- `PATCH /v1/public-contractors/:id`
