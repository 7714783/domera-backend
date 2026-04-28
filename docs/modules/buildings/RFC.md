# Module RFC — `buildings`

## 1. Why this module exists

Top-level container for everything in a workspace. Every Prisma model that carries operational state (assets, tasks, incidents, cleaning, documents) is scoped to a `buildingId`, and that id is resolved via this module. Owns building lifecycle (`draft` → `active` → `archived`), public attributes (name, slug, address, timezone), and the workspace-wide list endpoint.

## 2. Scope and non-scope

### In scope
- `Building` CRUD, slug uniqueness per tenant, lifecycle transitions (publish / archive / reactivate) with `audit.transition`.
- Building delete with name confirmation (sensitive=true).
- List endpoint returning every building the actor has any role in.
- Lifecycle gating: archived buildings hide from the operational nav but stay queryable for compliance/audit.

### Out of scope
- Floors / units / locations / systems → `building-core`.
- Building occupancy contracts → `leases`.
- Per-building tenants (occupant companies) → `occupants` / `tenant-companies`.
- PPM / cleaning / reactive that happen INSIDE the building → respective domain modules.

## 3. Owned entities

| Model | Table |
|---|---|
| `Building` | `buildings` |

## 4. Tenant scope

Tenant-scoped via RLS (policy `tenant_isolation` on `buildings`).

## 5. Events emitted

`building.created`, `building.lifecycle.changed` (subject = lifecycleStatus pair), `building.deleted`. Emitted via `audit.transition` for sensitive transitions; outbox is not currently consumed by other modules.

## 6. Permissions

- `building.read` — list + get.
- `building.manage` — create / update / archive.
- `workspace_owner` permission set — delete with name confirmation (the only safety net against accidental data loss).

## 7. Surface

- `GET /v1/buildings`
- `GET /v1/buildings/:slug`
- `POST /v1/buildings`
- `PATCH /v1/buildings/:slug`
- `POST /v1/buildings/:slug/publish`
- `POST /v1/buildings/:slug/archive`
- `POST /v1/buildings/:slug/reactivate`
- `DELETE /v1/buildings/:slug` (workspace_owner; requires confirmation body)

## 8. Hard rules

1. `slug` is unique per tenant — collision returns 409.
2. Building cannot be deleted while it has active occupancy contracts. Caller must terminate / migrate first.
3. Lifecycle transitions are audited via `audit.transition` (sensitive=true).
4. Archived buildings are filtered out of `GET /v1/buildings` by default; pass `includeArchived=1` to see them.
