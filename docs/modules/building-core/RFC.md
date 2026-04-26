# Module RFC — `building-core`

## 1. Why this module exists

Structural model of a building: floors, units, locations, systems, vertical transport, occupant companies. Every other module that needs a "place" or a "subsystem" reads from here. This is the spatial backbone.

## 2. Scope and non-scope

### In scope
- BuildingFloor, BuildingUnit, BuildingLocation, BuildingSystem, BuildingVerticalTransport, ElevatorProfile.
- Per-building summary endpoint (counts + alerts roll-up).
- Bulk floor/unit creation during onboarding bootstrap.

### Out of scope
- Building entity itself — owned by `buildings`.
- Tenant company occupancy — `occupants` is canonical writer (building-core has a legacy create path, see ssot-ownership ambiguous list).

## 3. Owned entities (writes)

| Model | Table |
|---|---|
| `BuildingFloor` | `building_floors` |
| `BuildingUnit` | `building_units` |
| `BuildingLocation` | `building_locations` |
| `BuildingSystem` | `building_systems` |
| `BuildingVerticalTransport` | `building_vertical_transport` |
| `ElevatorProfile` | `elevator_profiles` |
| `BuildingOccupantCompany` | shared with `occupants` (legacy create-path; consolidation P2) |
| `BuildingUnitOccupancy` | shared with `occupants` |
| `BuildingContract` | shared with `leases` (lifecycle ownership) |
| `Entrance`, `EquipmentRelation`, `ParkingSpot`, `StorageUnit` | exempt-listed in ownership-coverage |

## 4. Reads (no writes)

| Model | Why |
|---|---|
| `Building` | resolve buildingId from slug |
| `Tenant` | scope guard via PrismaService |

## 5. Incoming events

None planned — building-core is a leaf for the spatial model.

## 6. Outgoing events

None today. Future: `building.floor.created` → invalidate frontend caches.

## 7. Workflow states

No workflow case. `BuildingFloor.isActive` is a boolean; no state machine.

## 8. Failure / rollback rules

- `createUnit` rejects duplicate `unitCode` per building (DB unique constraint).
- `createLocation` rejects duplicate `code` and validates `floorId` exists in same building.

## 9. Audit points

- `audit.write` on create/update/delete via `requireManager` paths.
- INIT-010 follow-up: `audit.transition` on `BuildingUnitOccupancy` lifecycle (vacant→occupied→vacated).

## 10. RBAC + scope

`requireManager(tenantId, actorUserId, { buildingId })` on all writes. Reads are tenant-scoped via header.

## 11. Tenant isolation

PrismaService + RLS. Every method either calls `resolveBuildingId(tenantId, slug)` or filters by `where: { tenantId, buildingId }`.

## 12. DoR checklist

- [x] Backend endpoints exist
- [x] Frontend renders real data (building core overview, floors, units, systems, locations)
- [x] Data persists; survives refresh
- [x] Tenant isolation enforced
- [x] RBAC enforced
- [x] State machine — N/A
- [ ] Outgoing events declared — none yet
- [x] No cross-module direct writes (occupants/leases dual-ownership documented)

## 13. Open questions

- Consolidation of `BuildingOccupantCompany` create-paths to `occupants`-only (P2).
- Floor-plan SVG visualisation — backlog.
