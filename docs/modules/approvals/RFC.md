# Module RFC — `approvals`

## 1. Why this module exists

Generic multi-step approval engine. Spend approvals (PPM expense legs), document approvals, role-change approvals — all flow through one state machine. Includes Separation-of-Duties (SoD) enforcement and delegation chains.

## 2. Scope and non-scope

### In scope
- ApprovalPolicy (rule definitions), ApprovalRequest (instances), ApprovalStep (per-level state), ApprovalDelegation (substitute approver windows).
- Approve / reject / supersede actions.
- Bottleneck reporting (`GET /v1/approvals/bottlenecks`).

### Out of scope
- The thing being approved (PPM case, document publish, etc.) — approvals stays subject-agnostic via `subjectType` + `subjectId`.

## 3. Owned entities (writes)

| Model | Table |
|---|---|
| `ApprovalPolicy` | `approval_policies` |
| `ApprovalRequest` | `approval_requests` |
| `ApprovalStep` | `approval_steps` |
| `ApprovalDelegation` | `approval_delegations` |

## 4. Reads (no writes)

| Model | Why |
|---|---|
| `Building` | display + scope |
| `User` | actor identification |
| `BuildingRoleAssignment` | role check at approve time |

## 5. Incoming events

| Event | Producer | Effect |
|---|---|---|
| `ppm.expense.requested` (planned) | ppm | create ApprovalRequest with type=spend_approval |

Today the consumer relationship is DI-based (PpmService → ApprovalsService); INIT-010 Phase 6 moves to event-driven.

## 6. Outgoing events

| Event | Payload | Consumers |
|---|---|---|
| `approval.granted` v1 | approvalId, tenantId, subjectType, subjectId, grantedBy | ppm, reactive |
| `approval.rejected` v1 | approvalId, tenantId, subjectType, subjectId, reason | ppm, reactive |

## 7. Workflow states

`approval_request` REGISTRY:

```
pending → approved | rejected
approved → fulfilled    (when consumer marks the subject as actioned)
```

Per-step micro-transitions: `pending → approved | rejected` per `ApprovalStep`.

## 8. Failure / rollback rules

- SoD: technician role cannot approve spend (hardcoded in service).
- Delegation must be active (`isActive=true` and date window ok) at approve time.
- `supersede` policy bumps version + sets prior policy.status=`superseded`.

## 9. Audit points

- `audit.transition()` on every approval state change (INIT-010 P0-3, 2026-04-26).
- Legacy `audit.write({entityType: 'approval'})` retained for backwards-compat with audit list UI.

## 10. RBAC + scope

| Endpoint | Permission | Scope |
|---|---|---|
| `GET /v1/approvals` | role gate by `pendingStep.role` | tenant |
| `POST /v1/approvals/:id/approve` | actor must hold pendingStep.role OR active delegation | step-bound |
| `POST /v1/policies` | `approval.policy.manage` | tenant/org |

## 11. Tenant isolation

PrismaService + RLS. Approval policy cascades by tenantId.

## 12. DoR checklist

- [x] Backend endpoints exist
- [x] Frontend renders real data (approvals-list)
- [x] Data persists; survives refresh
- [x] Tenant isolation enforced
- [x] RBAC enforced
- [x] State machine in REGISTRY
- [x] Outgoing events declared in CATALOG
- [x] audit.transition wired (INIT-010 P0-3)

## 13. Open questions

- Outbox-based publish vs DI for approval.granted/rejected — INIT-010 Phase 6.
