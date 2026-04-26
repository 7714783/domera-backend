# Module RFC — `tenant-companies`

## 1. Why this module exists

INIT-007 Phase 4. Provides the "promote a User to TENANT_COMPANY_ADMIN" flow + read API for self-service occupant scoping. Reads BuildingOccupantCompany (owned by `occupants`); writes only the `adminUserId` field via a controlled endpoint.

## 2. Scope / non-scope

**In:**
- `GET /v1/buildings/:id/tenant-companies` (list per building)
- `GET /v1/tenant-companies/:id` (detail)
- `POST /v1/tenant-companies/:id/admin` (promote/replace admin) — creates `BuildingRoleAssignment` with scope `tenantCompanyId = company.id`.

**Out:** BuildingOccupantCompany create/delete — `occupants` module.

## 3. Owned entities

| Model | Table | Notes |
|---|---|---|
| `BuildingOccupantCompany.adminUserId` field only | shared with `occupants` (canonical) and `building-core` (legacy create-path) |
| `BuildingRoleAssignment` | shared with `iam` — tenant-companies only writes `tenantCompanyId` scope on tenant_company_admin grants |

## 4. Reads
- `Building` — for slug/name display.
- `User` — verify the promotion target.

## 5. Events
None today. Planned: `tenant_company.admin_changed` → role-dashboards refresh.

## 7. Workflow states
None.

## 8. Failure / rollback
- Promote rejects when target user is not a member of the tenant.
- Atomic: revoke previous admin's role + grant new + write audit in single transaction.

## 9. Audit
- `audit.write({ eventType: 'tenant_company.admin_changed', metadata: { before, after } })` on every promote.

## 10. RBAC
- `requireManager(tenantId, actorUserId)` on POST.

## 11. Tenant isolation
RLS-enabled via migration 010. PrismaService auto-wraps.

## 12. DoR
- [x] Backend endpoints
- [x] audit.write wired
- [x] Tenant + RBAC enforced
- [x] No cross-module writes (only field-scoped on shared entity, documented in ssot)

## 13. Open questions
- Self-promote when target user IS the only member (edge case) — backlog.
