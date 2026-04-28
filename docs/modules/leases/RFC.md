# Module RFC — `leases`

## 1. Why this module exists

Owns the **occupancy contract** between an occupant company and one or more building units / parking spots / storage rooms. A `BuildingContract` records who occupies what, for how long, at what monthly amount; `LeaseAllocation` apportions the monthly amount across the specific targets (a contract for ₪10k/mo can split 70%/30% across two units).

Lease termination triggers cascade for cleanup of dependent state (notifications, recurring PPM scope narrowing).

## 2. Scope and non-scope

### In scope
- `BuildingContract` lifecycle (`draft` → `active` → `terminated`) with `audit.transition`.
- `LeaseAllocation` CRUD — must sum to the contract's monthly amount within rounding tolerance.
- Termination guard — refuse if active allocations exist (caller must remove them first).
- Read-side aggregation: occupancy timeline per building / per unit.

### Out of scope
- Occupant company catalogue — `occupants` / `tenant-companies`.
- Unit / parking / storage entity definition — `building-core`.
- Invoice / payment processing — `vendor-invoices` (which actually handles outgoing-only) + future `tenant-invoices`.
- Document storage (signed lease PDF) — `documents`.

## 3. Owned entities

| Model | Table | Notes |
|---|---|---|
| `BuildingContract` | `building_contracts` | shared write with `building-core` (legacy create path). OWNERSHIP entry: `['building-core', 'leases']`. |
| `LeaseAllocation` | `lease_allocations` | tenant-scoped, INIT-010 added RLS in migration 021. |

## 4. Tenant scope

Tenant-scoped via RLS on both tables. INIT-010 closed the `lease_allocations` RLS gap (was in `KNOWN_GAPS` previously).

## 5. Events

`lease.contract.created`, `lease.contract.terminated` — emitted via outbox; `notifications` module can subscribe in Phase 2 to alert occupant company admins.

## 6. Permissions

- `building.read` — see occupancy.
- `lease.manage` — create / update / terminate.
- `approval.approve_l3` — required to terminate a contract that still has active allocations.

## 7. Surface

- `GET /v1/buildings/:slug/contracts`
- `POST /v1/buildings/:slug/contracts`
- `PATCH /v1/contracts/:id` (incl. terminate)
- `GET /v1/contracts/:id/allocations`
- `POST /v1/contracts/:id/allocations`
- `DELETE /v1/contracts/:id/allocations/:allocationId`

## 8. Hard rules

1. Allocations sum cannot exceed `BuildingContract.monthlyAmount` ± 0.01.
2. Termination is `audit.transition(sensitive=true)`.
3. RLS-scoped — every read / write goes through tenant context.
