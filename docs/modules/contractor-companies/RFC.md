# Module RFC — `contractor-companies`

## 1. Why this module exists

INIT-007 Phase 6. Universal contractor registry that unifies cleaning + technical + security vendors under one scope dimension. CONTRACTOR_MANAGER role narrows by `contractorCompanyId` regardless of domain.

## 2. Scope / non-scope

**In:** ContractorCompany CRUD (create / list / get / patch with isActive toggle); domains (`cleaning|technical|security|generic`).
**Out:** CleaningContractor (legacy domain-specific table) — bridged via `cleaning_contractors.contractorCompanyId` FK; cleaning module still owns its hierarchy table.

## 3. Owned entities

| Model | Table |
|---|---|
| `ContractorCompany` | `contractor_companies` |

## 4. Reads
- `CleaningContractor` — read-only via FK lookup for migration tooling.
- `WorkOrder` / `TaskInstance` — gain `contractorCompanyId` FK populated at intake.

## 5. Incoming events / 6. Outgoing events
None today. Planned: `contractor.created/updated` → reactive (vendor list refresh).

## 7. Workflow states
No workflow. `isActive` boolean.

## 8. Failure / rollback
- `create` rejects unknown domain.
- `create` enforces unique `(tenantId, name)`.

## 9. Audit
- `audit.write({ entityType: 'contractor_company' })` on every create + update.

## 10. RBAC
- `requireManager(tenantId, actorUserId)` on create/update.
- Read open to all building.read.

## 11. Tenant isolation
RLS-enabled (migration 014); PrismaService auto-wraps.

## 12. DoR
- [x] Backend CRUD + 4 endpoints
- [ ] Frontend — no dedicated UI yet; managed via API
- [x] Tenant + RBAC enforced
- [x] audit.write on mutations
- [x] No cross-module writes

## 13. Open questions
- Frontend management UI — backlog.
- `cleaning_contractors.contractorCompanyId` backfill — INIT-007 Phase 6 follow-up.
