# Building Core v1

First-building-first, multi-building-ready. Grew out of modelling one real
office tower ("Business Center 1") — not an abstract catalog.

## Source object

Real building used as the reference:

- Office tower, ground floor with restaurants, parking B1..B5.
- Working floors 1..19, each divisible up to 8 office units.
- Rooftop mechanical: 4 chillers, toilet exhaust (×3), restaurant exhaust
  (mindafim), smoke extraction, stair pressurization, other ventilation.
- Electrical: utility feed (shnai hevrat hashmal), main electrical room,
  generator.
- Lifts: 6 passenger G..19, 1 freight −4..20, 2 parking lifts G..−5.
- Basement level −5 pump room: 2 drinking-water pumps, 1 fire sprinkler pump.

## Decomposition rule

A single wide `buildings` row **cannot** represent this truthfully. Each
concern lives in its own table, every row carries `tenantId + buildingId`.

```
Building (1)
├── BuildingFloor (-5..20)
│   └── BuildingUnit                   // 8 per office floor
├── BuildingVerticalTransport           // 6 passenger + 1 freight + 2 parking
├── BuildingSystem                      // hvac / ventilation / smoke_extraction
│                                       // stair_pressurization / electrical
│                                       // plumbing / fire_safety ...
├── BuildingOccupantCompany             // ≠ SaaS Tenant
│   ├── BuildingUnitOccupancy           // which company sits in which unit
│   └── BuildingContract                // lease | service
└── BuildingMandate / BuildingSettings  // existing
```

## Critical naming rule: `tenant` vs `occupant_company`

- **`Tenant`** (SaaS) — workspace, RLS boundary, billing boundary. Do not
  reuse this word for building tenants.
- **`BuildingOccupantCompany`** — the company that rents/occupies a unit.
  Lives inside a workspace, linked through `BuildingUnitOccupancy`.

## Tables introduced

| Table                         | Purpose                                                      |
|-------------------------------|--------------------------------------------------------------|
| `building_floors`             | physical floor level `-5..N` with type (parking, office, lobby_commercial, technical, roof) |
| `building_units`              | rentable block on a floor (office/retail/technical/storage)  |
| `building_vertical_transport` | passenger/freight/parking lifts with serves_from/to range    |
| `building_systems`            | MEP systems with `systemCategory` + `systemCode`             |
| `building_occupant_companies` | companies present in the building                            |
| `building_unit_occupancies`   | `unit ↔ company` link with dates + status                    |
| `building_contracts`          | `lease` or `service` contracts with optional unit scope      |

Unique constraints:

- `(buildingId, floorCode)`, `(buildingId, unitCode)`,
  `(buildingId, code)` on transport, `(buildingId, systemCode)` on systems.

## `Building` row itself

Stays slim but gains descriptive fields that are natural to filter by:

`buildingCode, buildingType (office_tower), primaryUse (office),
secondaryUses[], complexityFlags[], floorsAboveGround, floorsBelowGround,
hasParking, hasRestaurantsGroundFloor, hasRooftopMechanical, notes`.

Ad-hoc rarely-queried data still goes into `buildings.attributes Json`.

## REST contract

Controller: `@Controller('buildings/:id')` — `:id` accepts UUID or slug.

| Verb   | Path                                          | Purpose                                  |
|--------|-----------------------------------------------|------------------------------------------|
| GET    | `/v1/buildings/:id/summary`                   | Aggregate counts (floors, units, lifts, systems by category, transport by type, occupants, contracts) |
| GET    | `/v1/buildings/:id/floors`                    | List floors                              |
| POST   | `/v1/buildings/:id/floors`                    | Create floor                             |
| GET    | `/v1/buildings/:id/units`                     | List units with floor info               |
| POST   | `/v1/buildings/:id/units`                     | Create unit (requires existing floorId in same building) |
| PATCH  | `/v1/buildings/:id/units/:unitId`             | Update unit                              |
| GET    | `/v1/buildings/:id/transport`                 | List vertical transport                  |
| POST   | `/v1/buildings/:id/transport`                 | Create transport (validates floor range) |
| GET    | `/v1/buildings/:id/systems`                   | List systems                             |
| POST   | `/v1/buildings/:id/systems`                   | Create system                            |
| PATCH  | `/v1/buildings/:id/systems/:systemId`         | Update system                            |
| GET    | `/v1/buildings/:id/occupants`                 | List occupant companies with occupancies |
| POST   | `/v1/buildings/:id/occupants`                 | Create occupant company                  |
| POST   | `/v1/buildings/:id/occupancies`               | Assign company to unit                   |
| GET    | `/v1/buildings/:id/contracts`                 | List contracts                           |
| POST   | `/v1/buildings/:id/contracts`                 | Create contract (`lease` or `service` only) |

Auth headers: `Authorization: Bearer <jwt>`, `X-Tenant-Id: <workspace-id>`.
Service enforces `workspace_owner | workspace_admin | org_admin` membership
or `building_manager | chief_engineer` on the building.

## Validation rules enforced

- All rows require `tenantId` + `buildingId`.
- `unit` cannot be created without an existing `floorId` in the same building.
- `occupancy` requires both `unitId` and `occupantCompanyId` to belong to the
  same building.
- `contract.contractType` must be `lease` or `service`.
- `transport.servesFrom/To` must fit inside
  `[-floorsBelowGround - 2 .. floorsAboveGround + 2]`.
- No giant JSON blob is the source of truth — `buildings.attributes` is
  optional free-form only.

## Example: first real building

Seed: `apps/api/prisma/seeds/seed-first-real-building.mjs` — idempotent,
creates "Business Center 1" under Menivim's workspace with:

- 26 floors (−5..20) typed by level (parking → lobby_commercial → office
  → technical / roof).
- 152 office units (19 office floors × 8 divisible zones).
- 3 transport rows, total 9 lifts (6 passenger / 1 freight / 2 parking).
- 14 systems across 7 categories (hvac, ventilation, smoke_extraction,
  stair_pressurization, electrical, plumbing, fire_safety).

## How a second building is added

No schema change, no hidden "current building" on the server:

1. `POST /v1/buildings` (body with basics + optional structural metadata).
2. `POST /v1/buildings/:slug/floors` repeatedly, or seed script.
3. `POST /v1/buildings/:slug/units`, `…/transport`, `…/systems` etc.

Verified end-to-end: second building created, first building's counts
stay untouched, `GET /v1/buildings` returns both.

## Deliberately out of scope (v1)

- Automatic floor/unit templates per building type.
- Maintenance tickets, invoicing by lease, IoT telemetry.
- Broad refactor of existing modules (approvals, compliance, imports).
- Universal building wizard. The seed + raw REST is enough for now.
