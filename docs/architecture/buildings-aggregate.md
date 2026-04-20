# Buildings Aggregate — Multi-Building Architecture

Source of truth for how Domera stores and evolves one building today while
staying ready for a portfolio of many tomorrow.

## Rule: `tenant_id + building_id` everywhere

Every row that represents data *about* a building — assets, obligations, tasks,
budgets, approvals, documents, audit, settings, role assignments — carries both
`tenantId` (for SaaS isolation via RLS) and `buildingId` (for portfolio-level
queries). No helper is allowed to assume "the one building" — all services take
a `buildingId` parameter or a slug that resolves to one.

```
Workspace (Tenant)
└── Building                      // 1..N per workspace
    ├── Entrances                 // 1..N
    ├── Floors                    // linked to entrance optionally
    │   └── Units                 // apartments / offices
    ├── Assets (tree)             // systems + equipment (incl. lifts)
    ├── BuildingSettings          // currency, billing, locale
    ├── BuildingMandates          // owner / operator / vendor / consultant
    ├── BuildingRoleAssignments   // per-building RBAC
    ├── PpmPlanItems / TaskInstances
    ├── Budgets / Invoices / Approvals
    ├── Documents / AuditEntries
    └── Contracts / Accounts / ResidentRequests
```

## Core table shape

```prisma
model Building {
  id                   String
  tenantId             String         // always present
  organizationId       String?        // nullable — set by mandate
  slug                 String         // @@unique([tenantId, slug])
  name                 String
  // --- extensible core ---
  buildingType         String?        // residential | office | mixed | commercial
  yearBuilt            Int?
  floorsCount          Int?
  unitsCount           Int?
  entrancesCount       Int?
  liftsCount           Int?
  // --- address ---
  addressLine1         String
  street               String?
  buildingNumber       String?
  city                 String
  countryCode          String
  lat                  Float?
  lng                  Float?
  timezone             String
  // --- i18n ---
  defaultLanguage      String?
  supportedLanguages   String[]
  // --- operations ---
  status               String         // draft | active | warning | archived
  compliance           Int
  // --- extra / operational ---
  annualKwh            Float?
  attributes           Json?          // free-form for non-structured extensions
  createdAt, updatedAt, createdBy
}
```

### Why hybrid (columns + optional `attributes` JSON)

- **Columns** host fields that we query/filter/index: type, floors_count,
  country, status.
- **`attributes` JSON** is a controlled extension point for ad-hoc fields we
  aren't ready to promote to first-class columns yet (e.g. `has_kitchen_hood`,
  `primary_use`). Nothing load-bearing lives only in this blob.

### Extension rule

When a new building field becomes stable:

1. Add the column in `schema.prisma` with a safe default (`@default(...)`)  
2. Run `pnpm --filter @domera/api db:migrate:dev --name add_<field>` to author
   the migration and apply it locally. `prisma db push` is no longer the
   accepted path — see `docs/architecture/database-migrations.md`.
3. Update the `PATCH /v1/buildings/:slug` `allowed` list in
   `BuildingsService.update`.
4. Surface it in `/buildings/:slug/settings` UI.
5. Old buildings keep working (nullable or defaulted).

## REST contract — `/v1/buildings/*`

| Verb   | Path                          | Purpose                               | Auth           |
|--------|-------------------------------|---------------------------------------|----------------|
| GET    | `/v1/buildings`               | List buildings in active workspace    | bearer+tenant  |
| GET    | `/v1/buildings/:idOrSlug`     | One building with entrances/floors/units/settings/lifts | bearer+tenant |
| POST   | `/v1/buildings`               | Create (requires workspace_owner / workspace_admin / org_admin) | bearer+tenant |
| PATCH  | `/v1/buildings/:slug`         | Update allowed fields                 | bearer+tenant  |

Headers:

- `Authorization: Bearer <jwt>` — identifies the actor.
- `X-Tenant-Id: <workspace-id>` — declares which workspace to operate in.  
  Middleware validates that the actor has a membership in that workspace
  (enforced at service level via `requireManager`).

### POST body (minimum)

```json
{
  "name": "Tower One",
  "addressLine1": "Herzl 12",
  "city": "Tel Aviv",
  "countryCode": "IL",
  "timezone": "Asia/Jerusalem",
  "buildingType": "residential"
}
```

Server auto-creates on success: `BuildingSettings`, `BuildingRoleAssignment`
(actor → `building_manager`), `BuildingMandate` (if `organizationId` supplied),
and writes an `AuditEntry`.

### Onboarding wrapper

`/v1/onboarding/bootstrap` is a convenience for the very first building: it
auto-creates the workspace and an owner organization if the user doesn't have
any yet, then delegates to the same `createBuilding` path. After that, every
subsequent building goes through the standard REST API — **no single-building
shortcut exists in the backend.**

## Ownership & participation

A building alone does not describe "who runs it". Two relations do:

- **`BuildingMandate(type, organizationId, effectiveFrom, effectiveTo)`** —
  contractual relationship of an organization to the building:
  `owner | management_company | service_contract | consultant`. Multiple
  concurrent mandates are allowed (e.g. owner + operator + one vendor).
- **`BuildingRoleAssignment(userId, roleKey, delegatedBy, expiresAt)`** —
  per-building RBAC. Operator's `building_manager` on Tower One, vendor's
  `vendor_user` on Tower Two — same user, different buildings, different roles.

## Adding a second building

No schema change, no refactor. Flow:

1. `GET /v1/buildings` → shows existing portfolio.
2. User clicks **+ Add building** → `/buildings/new` → `POST /v1/buildings`.
3. Redirected to `/buildings/:slug/settings` for detailed configuration.
4. All existing queries and policies already scope by `buildingId` — dashboards,
   compliance, PPM materializer, audit — nothing needs change.

The RLS layer isolates the whole workspace; within a workspace, per-building
visibility is enforced by `BuildingRoleAssignment` (a vendor sees only the
buildings they have a role on).

## Where new building-level state lives — decision tree

- Needed for filtering / search / index → **column** on `buildings`.
- 1:N structured rows (floors, units, entrances, assets, documents) →
  **dedicated table** with `buildingId` FK.
- One-of settings (currency, billing cycle, locale) → **`BuildingSettings`**.
- Free-form, rarely-queried → **`buildings.attributes JSONB`**, promote to a
  column when usage justifies it.
- Cross-building / portfolio-level → **tenant-scoped table** (e.g. `vendors`).

## What is explicitly NOT done

- No `building = tenant` shortcut anywhere.
- No "current building" stored on the backend user — the client passes
  `X-Tenant-Id` and the route carries `:slug` / `:id`.
- No giant JSON blob as primary storage.
- No hidden joins that assume a single row.
