# Cleaning module

Bounded context for per-building cleaning operations. Not a TaskInstance.
Not a WorkOrder. A parallel vertical that intentionally owns its own data
model so it can evolve independently and so that a cleaning SLA breach does
not tangle with PPM compliance logic.

## Data model (9 tables, all under RLS + FORCE)

| Table | Purpose |
|---|---|
| `cleaning_contractors` | One row per contractor per building. Unique by `(buildingId, name)`. |
| `cleaning_roles` | The 5 canonical role codes (`boss | manager | supervisor | cleaner | dispatcher`) scoped to each contractor. Unique by `(contractorId, code)`. |
| `cleaning_staff` | People working for a contractor. `managerId` links up the hierarchy; `userId` optional link to a Domera user. |
| `cleaning_zones` | Zone of responsibility. Unique by `(buildingId, code)`. Optional `contractorId` + `supervisorStaffId` drive auto-routing. |
| `cleaning_qr_points` | Physical QR stickers. Short unguessable public `code`. |
| `cleaning_requests` | The unit of work. `status ∈ new | assigned | in_progress | done | rejected | cancelled`. `source ∈ dashboard | qr | admin | dispatcher`. |
| `cleaning_request_comments` | Ordered per-request comments (optionally internal). |
| `cleaning_request_attachments` | Photos / service-report links. |
| `cleaning_request_history` | Append-only audit of every creation + assignment + status change. |

## Scope-based RBAC

`CleaningAccessService.resolve(tenantId, userId)` walks:

1. `user.isSuperAdmin` → `platform_admin`
2. Tenant-level membership `workspace_owner | workspace_admin | org_admin` → `operations_manager` (all buildings)
3. BuildingRoleAssignment `building_manager | operations_manager | chief_engineer` → `building_manager` (buildings listed in role)
4. `cleaning_staff.userId` match → role code → actor type (`cleaning_boss` / `cleaning_manager` / `cleaning_supervisor` / `cleaner`)

`filterForActor()` returns a Prisma-ready WHERE that bounds what they can see:

- operations_manager → `buildingId: { in: [...] }`
- cleaning_boss/manager → `buildingId + contractorId: { in: [...] }`
- supervisor → `contractorId + (zoneId in [...] OR assignedStaffId = self)`
- cleaner → `contractorId + assignedStaffId = self`

`canChangeStatus(actor, from, to)` enforces both the **state transition graph**
and the **per-role** subset (a cleaner can only go `assigned → in_progress → done`).

## Auto-assignment

On create (internal or public-QR):

1. Start with `zone.contractorId` if present (or the caller's override).
2. Start with `zone.supervisorStaffId` if present as `assignedStaffId`.
3. If staff is picked, mark `status = assigned` and stamp `assignedAt`.
4. Otherwise `status = new` and the request falls into the unassigned pool.

Every decision is written to `cleaning_request_history` with `action="created"`
and a payload `{ contractorId, assignedStaffId, status }`.

## Public QR flow

```
[User scans sticker]
        │
        ▼
GET  /qr/cleaning/:code  (frontend page)
        │
        ▼
GET  /v1/public/cleaning/qr/:code  ── resolvePublic() via MigratorPrismaService
        │   returns building + zone + categories + label (no internal ids leaked)
        ▼
POST /v1/public/cleaning/qr/:code/request
        │   rate-limited (5/min per IP per code)
        ▼
CleaningRequest row (source="qr")
        │   auto-routed via zone → contractor + supervisor
        ▼
[Internal dashboard shows it immediately; scope-filtered per viewer]
```

`MigratorPrismaService` (separate Prisma client with `BYPASSRLS`) is used *only*
for the bootstrap QR resolve + public request create, because the public path
has no tenant context and the app role (`domera_app`) is `NOBYPASSRLS` + all
cleaning tables have `FORCE ROW LEVEL SECURITY`. Once a user is authenticated,
all queries go through the normal `PrismaService` with ALS-driven tenant
context.

## Endpoints

### Internal (session required; actor-scoped)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/cleaning/requests` | Filters: status, priority, contractorId, zoneId, source, buildingId |
| `GET` | `/v1/cleaning/requests/:id` | Includes zone, comments, history, attachments |
| `POST` | `/v1/cleaning/requests` | Manual/dashboard create |
| `PATCH` | `/v1/cleaning/requests/:id/status` | Body `{ status }` — enforces transition graph + role subset |
| `PATCH` | `/v1/cleaning/requests/:id/assign` | Body `{ contractorId?, assignedStaffId? }` |
| `POST` | `/v1/cleaning/requests/:id/comments` | Body `{ body, isInternal? }` |
| `GET` | `/v1/cleaning/contractors` | |
| `POST` | `/v1/cleaning/contractors` | Seeds default role set for the contractor |
| `GET` | `/v1/cleaning/contractors/:id/staff` | |
| `POST` | `/v1/cleaning/contractors/:id/staff` | `{ fullName, roleCode, managerId?, … }` |
| `GET` | `/v1/cleaning/zones` | |
| `POST` | `/v1/cleaning/zones` | |
| `PATCH` | `/v1/cleaning/zones/:id/assignment` | Reassign contractor/supervisor |
| `GET` | `/v1/cleaning/qr-points` | |
| `POST` | `/v1/cleaning/qr-points` | Generates unique short code + public URL |

### Public (no auth)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/v1/public/cleaning/qr/:code` | 60/min per code · returns only what the form needs |
| `POST` | `/v1/public/cleaning/qr/:code/request` | 5/min per (code, IP) · returns `{ reference, status, requestedAt, zone }`, no internal ids |

## Frontend pages

- `/qr/cleaning/[code]` — public, zero-auth single-page form. Shows building + zone auto-resolved; category dropdown; optional contact info; success screen with an 8-char reference.
- `/[locale]/cleaning` — internal list scoped by actor role. Filters: status · priority · source · contractor. Sidebar nav entry (en=Cleaning · he=ניקיון · ru=Уборка).

## Dev seed

```bash
APP_URL=http://localhost:3000 \
DATABASE_URL_MIGRATOR="postgresql://domera_migrator:domera_migrator@localhost:5432/domera_local?schema=public" \
node apps/api/prisma/seeds/seed-cleaning-demo.mjs
```

Creates:

- `CleanPro A` contractor (floor 1 + restroom 3F) with full hierarchy: Aaron (boss) → Anna (manager) → Avi (supervisor) → Adam (cleaner).
- `SparkleCo B` contractor (floor 2) with: Ben (boss) → Bella (manager) → Boris (cleaner).
- Zones: `F1`, `F2`, `WC-3`.
- One QR point on the 3rd-floor restroom; the JSON output includes the publicUrl so you can open it directly.
- One pre-seeded cleaning request (source=admin) to make the internal list non-empty.

## Out of scope for MVP (deliberate)

- Advanced analytics / SLA dashboards specific to cleaning
- Mobile app cleaner UI
- Automated contractor billing
- AI task distribution
- Merging cleaning requests with maintenance tasks
