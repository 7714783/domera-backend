# Module RFC — `audit`

## 1. Why this module exists

Sole writer of `AuditEntry`. Every other module calls `audit.write()` or `audit.transition()` to record a sensitive action. Provides search, CSV export, and the universal compliance trail (GDPR / SOX surface).

## 2. Scope and non-scope

### In scope
- AuditEntry write + read API.
- `audit.transition()` helper (INIT-010 P0-3) — single entry point for state-change logging.
- CSV export endpoint.
- Tenant-scoped search + filter.

### Out of scope
- Domain-specific history tables (`cleaning_request_history`, `ppm_execution_logs`) — they remain as detail; audit_entries is the cross-cutting compliance row.

## 3. Owned entities (writes)

| Model | Table | Notes |
|---|---|---|
| `AuditEntry` | `audit_entries` | sole module writing `prisma.auditEntry.*`; every other write goes through `audit.write()` |

## 4. Reads (no writes)

None — audit reads its own table only.

## 5. Incoming events

None today. Subscribers don't write to audit; they call `audit.write/transition` synchronously inside the producing transaction.

## 6. Outgoing events

None.

## 7. Workflow states

`AuditEntry` is append-only — no transitions.

## 8. Failure / rollback rules

- audit.write failure does NOT roll back the producer (logged but request continues). Compliance accepts at-least-once.
- (Planned) audit-entries write goes via outbox in the same Prisma transaction as the state change so consistency is automatic — INIT-010 Phase 7.

## 9. Audit points

The module IS audit. Self-reference n/a.

## 10. RBAC + scope

| Endpoint | Permission |
|---|---|
| `GET /v1/audit/search` | `audit.read` |
| `GET /v1/audit/export.csv` | `audit.read` |

## 11. Tenant isolation

Every read filters by tenantId; RLS enforces at DB layer. Cross-tenant audit reads — only via super-admin bypass (rare, tracked separately).

## 12. DoR checklist

- [x] Backend endpoints exist
- [x] Frontend renders real data (audit-log page)
- [x] Tenant isolation enforced
- [x] RBAC enforced
- [x] State machine — N/A (append-only)
- [x] No cross-module direct writes (sole owner via `audit.write`)
- [x] Universal `audit.transition` helper landed

## 13. Open questions

- Long-term retention + warm/cold storage — backlog.
- Audit-coverage CI guard (grep for prisma.update without follow-up audit.write) — INIT-010 Phase 8.
