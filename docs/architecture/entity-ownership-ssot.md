# Entity Ownership — Single Source of Truth

> **Last audited:** 2026-04-26 (audit run + AssetsPage stub fix + Floor/Unit deprecation).
>
> Every business entity in Domera has exactly **one owning module** (creates / updates / deletes it). All other modules may **read** the entity by id or by foreign key, but **must not** write to it. This file is the contract.
>
> A grep-based CI check enforces it (see `apps/api/test/ssot-ownership.test.mjs`). Adding a new write call from the wrong module will fail CI with the specific file:line.

## Ownership map

| Entity (Prisma model → table) | Owner module | Read-only consumers (allowed) |
|---|---|---|
| `BuildingFloor` → `building_floors` | `building-core` | assignment, leases, reactive, public-qr, role-dashboards, qr-locations, cleaning |
| `BuildingUnit` → `building_units` | `building-core` | leases, occupants, assignment (floor-derive), reactive |
| `BuildingSystem` → `building_systems` | `building-core` | ppm, asset, condition-triggers, role-dashboards |
| `BuildingVerticalTransport` → `building_vertical_transport` | `building-core` | ppm, role-dashboards |
| `ElevatorProfile` → `elevator_profiles` | `building-core` | ppm |
| `BuildingOccupantCompany` → `building_occupant_companies` | `building-core` | tenant-companies (admin promotion only), leases |
| `Asset` → `assets` | `assets` | ppm, reactive, assignment, role-dashboards |
| `AssetType` → `asset_types` | `assets` | ppm |
| `Building` → `buildings` | `buildings` | every module reads |
| `BuildingMandate` → `building_mandates` | `organizations` | building-core |
| `Organization` → `organizations` | `organizations` | iam, vendor-invoices |
| `User` / `Membership` / `BuildingRoleAssignment` | `iam` (+ `auth` for User CRUD) | every module reads via ActorResolver |
| `Role` / `RolePermission` | seed only (`prisma/seeds/seed-reference.mjs`) | iam, authz |
| `Incident` / `ServiceRequest` | `reactive` | triage queue (read), public-qr (create one type) |
| `CleaningRequest` / `CleaningZone` / `CleaningContractor` / `CleaningStaff` | `cleaning` | role-dashboards |
| `CleaningRequestComment` / `CleaningRequestHistory` | `cleaning` | none |
| `WorkOrder` | `reactive` | role-dashboards |
| `Quote` / `PurchaseOrder` / `CompletionRecord` | `reactive` | approvals (Quote.approvalRequestId only), vendor-invoices |
| `ApprovalRequest` / `ApprovalStep` / `ApprovalPolicy` | `approvals` | reactive |
| `TaskInstance` / `PpmTemplate` / `PpmPlanItem` / `PpmExecutionLog` | `ppm` | role-dashboards, assets, reactive |
| `Document` / `DocumentLink` / `DocumentTemplate` | `documents` | every module references |
| `QrLocation` | `qr-locations` | public-qr |
| `Inventory*` / `StockLocation` / `StockMovement` | `inventory` | none |
| `AuditEntry` → `audit_entries` | `audit` (sole `.create`); read by everyone | every module writes via `audit.write()` |
| `FloorAssignment` / `UserAvailability` | `assignment` (INIT-004) | reactive (resolver only), public-qr (resolver only) |
| `ContractorCompany` | `contractor-companies` (INIT-007 P6) | reactive (workorder), cleaning (future bridge) |
| `BuildingOccupantCompany.adminUserId` field | `tenant-companies` (INIT-007 P4) | iam (read) |

## Hard rules

1. **Cross-module mutation is forbidden.** A service in module X may NOT call `prisma.<entity>.create/update/delete` if X is not the owner. The exception is `audit.write()` which is the canonical write path for the audit module.
2. **Foreign keys, not embedded copies.** When a module needs to reference an entity (e.g. PPM referencing an Asset), it stores the FK and looks up the canonical record at read time. It does **not** denormalise the name/status into its own table.
3. **The frontend never displays mock data on operational pages.** Sample data is permitted only in Storybook fixtures (path: `apps/frontend/src/**/__fixtures__/`). Operational pages must call an API endpoint. The `pages/assets-page.tsx` regression that prompted this doc is the canonical example of what not to do.
4. **Deprecated models stay in the schema with the leading `// DEPRECATED` block.** Once a model is marked deprecated, no new writes are added. Tables are dropped only via an explicit cleanup migration.

## Deprecated models (no new writes)

| Model | Replaced by | Marked |
|---|---|---|
| `Floor` → `floors` | `BuildingFloor` | 2026-04-26 |
| `Unit` → `units` | `BuildingUnit` | 2026-04-26 |

## Ambiguous / dual-ownership (consolidation follow-ups)

Cases where the audit caught more than one owner. Tracked here so they
don't silently grow into more cross-module writes.

| Entity | Owners today | Why ambiguous | Action |
|---|---|---|---|
| `BuildingOccupantCompany` | `occupants` (canonical) + `building-core` (legacy POST `/buildings/:id/occupants`) | INIT-001 left a create path on building-core that overlaps `/v1/occupants` | Consolidate to `occupants`; remove the building-core endpoint after frontend audit |
| `BuildingContract` | `building-core` (creates) + `leases` (status transitions) | Lifecycle straddles two modules | Acceptable — building-core registers the contract, leases owns post-creation lifecycle |
| `BuildingUnitOccupancy` | `building-core` + `occupants` | Both modules touch the join row | Consolidate to `occupants` once the building-core entry-points fade |
| `Incident` | `reactive` + `connectors` | Inbound webhooks legitimately create incidents from external sources | Acceptable — connectors is a thin write wrapper, no business logic |
| `CompletionRecord` | `reactive` + `ppm` + `imports` | PPM auto-closes its own tasks; imports backfills historic data | Acceptable — both are legitimate, neither is a manual user surface |

## When you add a new entity

1. Pick or create the owning module.
2. Add the row to the table above with read-only consumers.
3. Add or extend the SSOT test (`test/ssot-ownership.test.mjs`) so the grep guard knows about it.
4. Reference this doc in the PR description.
