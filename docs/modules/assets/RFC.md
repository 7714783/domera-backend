# Module RFC — `assets`

## 1. Why this module exists

Single source of truth for every physical thing in a building (chillers, generators, fire panels, pumps). Every other module that talks about a "piece of equipment" references this registry. Without this, PPM has nothing to schedule against and reactive workorders have no target.

## 2. Scope and non-scope

### In scope
- Asset registry (CRUD), AssetType taxonomy, custom attributes, documents, media, spare parts.
- Portfolio + per-building list endpoints.
- PPM attach/detach (manages the relation; does NOT manage the schedule).

### Out of scope
- Maintenance schedules — owned by `ppm`.
- Floor / location modelling — owned by `building-core`.
- Maintenance history aggregation — derived read-model populated by `ppm.case.closed` event subscriber.

## 3. Owned entities (writes)

| Model | Table | Notes |
|---|---|---|
| `Asset` | `assets` | full CRUD + soft-delete via `isActive=false` |
| `AssetType` | `asset_types` | taxonomy (HVAC, Electrical…); seeded |
| `AssetCustomAttribute` | `asset_custom_attributes` | typed extension |
| `AssetDocument` | `asset_documents` | doc-link rows; the Document itself lives in `documents` |
| `AssetMedia` | `asset_media` | photo/video links |
| `AssetSparePart` | `asset_spare_parts` | parts catalogue |

## 4. Reads (no writes)

| Model | Why we read | How |
|---|---|---|
| `BuildingLocation` | display location of an asset | FK `Asset.locationId` |
| `BuildingFloor` | floor context | FK chain via location |
| `Document` | doc detail when listing | FK `AssetDocument.documentId` |

## 5. Incoming events (subscriptions)

| Event | Producer | Effect |
|---|---|---|
| `ppm.case.closed` (planned) | ppm | append maintenance record + last-service date on Asset |
| `completion.recorded` (planned) | reactive | append work-order completion |

Currently consumed via direct DI (`PpmService`); migration to event-driven happens in INIT-010 Phase 7.

## 6. Outgoing events (publications)

| Event | Schema | Payload | Consumers |
|---|---|---|---|
| `asset.created` | v1 | assetId, tenantId, buildingId, systemFamily, createdBy | ppm, role-dashboards |
| `asset.updated` | v1 | assetId, tenantId, changes, updatedBy | role-dashboards |

Both declared in `event-contract.test.mjs` CATALOG.

## 7. Workflow states

`Asset` does not have a workflow case. Lifecycle field `lifecycleStatus` is enumerated but transitions are unrestricted by design (planned ↔ active ↔ standby ↔ out_of_service ↔ obsolete ↔ disposed). No state-machine entry today. If a strict procurement-driven lifecycle becomes a requirement, add a REGISTRY entry then.

## 8. Failure / rollback rules

- Asset.create fails atomically: bad assetTypeId / locationId → 404 before insert.
- Bulk import (`POST /v1/buildings/:id/assets/bulk-import`) wraps each row; partial success returns per-row diagnostics, no half-state.

## 9. Audit points

- `audit.write({ entityType: 'asset' })` on create / update / delete.
- `audit.write({ entityType: 'asset_media' })` on media delete (P2 quick-win — known gap).

## 10. RBAC + scope

| Endpoint | Permission | Scope |
|---|---|---|
| `GET /v1/assets`, `GET /v1/buildings/:id/assets` | `building.read` | tenant + buildingId via header |
| `POST /v1/buildings/:id/assets` | `asset.manage` (manager) | building |
| `PATCH /v1/assets/:id`, `DELETE /v1/assets/:id` | `asset.manage` | tenant |

## 11. Tenant isolation

Every query goes through `PrismaService` with `where: { tenantId }`. Portfolio list endpoint also enriches with building names through the same scope.

## 12. DoR checklist

- [x] Backend endpoints exist and return real data
- [x] Frontend renders real data (`assets-page.tsx` rewired 2026-04-26)
- [x] Data persists; survives refresh
- [x] Tenant isolation enforced (RLS + tenantId filter)
- [x] RBAC enforced
- [x] Manual happy-path verified (create asset → appears in list → detail page)
- [ ] State machine in REGISTRY — N/A (no workflow)
- [ ] Outgoing events wired in code — declared in CATALOG; runtime publish lives in INIT-010 Phase 6
- [x] No cross-module direct writes
- [x] No cross-module direct service imports without registered NestModule

## 13. Open questions

- Should `lifecycleStatus` become a real state machine? Decision deferred to Q3.
