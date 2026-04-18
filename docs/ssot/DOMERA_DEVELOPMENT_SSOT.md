# Domera Development SSOT

## Executive Position
Domera is an operating system for buildings, not a generic CRM and not a generic task manager.

Core system model:
`workspace -> organizations -> buildings -> mandates -> roles -> assets -> obligations -> plans -> tasks -> documents -> approvals -> audit`

## SSOT Invariants
1. `tenant != building`.
2. Workspace is SaaS isolation and subscription boundary.
3. Building is an operating asset inside workspace scope.
4. All tenant-owned entities require `tenant_id`.
5. All building-owned entities require `building_id`.
6. Sensitive actions must be audit-logged.
7. Recurrence and escalations are queue/worker-driven.
8. Stages must be incremental and rollback-safe.

## Rule System

### Global Rules
1. No large refactors without explicit need.
2. API defaults to REST-first with OpenAPI 3.1.
3. GraphQL is allowed only as read-side BFF.
4. Every endpoint must pass auth, authorization, audit, and rate-limit policy.
5. Regulated tasks cannot close without required evidence.
6. Requester cannot be final approver.
7. Executor cannot be sole final compliance approver.
8. Document author cannot be sole document approver.

### Data Rules
1. `next_due_at` is a derived projection from recurrence + completion history.
2. Excel formulas are never source of truth.
3. Compliance basis must be explicit: `statutory | standard | internal | recommended`.
4. Performer qualification requirements must be explicit and validated.

### Workflow Rules
1. Workflow definitions are versioned.
2. Every transition has actor, timestamp, and rationale.
3. Timer transitions and escalations are worker-driven.
4. Every external import uses preview -> validate -> commit.

## Phases and Subphases

### Phase 0: Product Governance Foundation
- Subphase 0.1: SSOT publication and immutable rules
- Subphase 0.2: Team conventions, command contract, acceptance criteria
- Subphase 0.3: Delivery cadence and rollback checkpoints

### Phase 1: Platform Foundations
- Subphase 1.1: Monorepo baseline (`pnpm`, `turbo`, app skeletons)
- Subphase 1.2: Environment contracts and secrets model
- Subphase 1.3: Local infra baseline (`postgres`, `redis`, basic health)
- Subphase 1.4: CI gates (`lint`, `typecheck`, `tests`, `build`)

### Phase 2: Identity and Tenancy Core
- Subphase 2.1: OIDC auth baseline
- Subphase 2.2: Workspace, organizations, memberships
- Subphase 2.3: Mandates and delegated administration
- Subphase 2.4: Hierarchical constrained RBAC and SoD checks

### Phase 3: Asset Operating Model
- Subphase 3.1: Buildings, floors, units, spaces
- Subphase 3.2: Asset classes and asset inventory
- Subphase 3.3: Building-scoped role assignments
- Subphase 3.4: Vendor scopes and service contracts

### Phase 4: Compliance and PPM Core
- Subphase 4.1: Obligation template catalog
- Subphase 4.2: Building obligation instantiation and applicability
- Subphase 4.3: PPM templates and plan items
- Subphase 4.4: Recurrence generation and due projections

### Phase 5: Controlled Execution
- Subphase 5.1: Task instances and work orders
- Subphase 5.2: Completion evidence policies
- Subphase 5.3: Closeout approvals and exceptions
- Subphase 5.4: Overdue/escalation automation

### Phase 6: Document and Approval Governance
- Subphase 6.1: Controlled documents and revision chains
- Subphase 6.2: Approval requests and step orchestration
- Subphase 6.3: Spend approval policies and budget checks
- Subphase 6.4: Audit and immutable trace exports

### Phase 7: Takeover and Import Flow
- Subphase 7.1: Import jobs and row-level validation
- Subphase 7.2: Regulator -> obligations mapping
- Subphase 7.3: PPM -> plan mapping
- Subphase 7.4: ST_PM -> completion backfill mapping
- Subphase 7.5: Red list and readiness scoring

### Phase 8: Admin and Decision Surfaces
- Subphase 8.1: Developer admin dashboard
- Subphase 8.2: Compliance dashboard
- Subphase 8.3: Role and delegation visibility
- Subphase 8.4: Approval bottleneck visibility

## Development Flows

### Flow A: Domain Change Flow
1. Define invariant impact.
2. Update schema and migration.
3. Update module contracts (DTO/use-case).
4. Add policy and audit checks.
5. Add tests and run gates.
6. Roll out behind feature flag if risky.

### Flow B: Import Flow (Excel)
1. Upload file.
2. Parse sheets (`Regulator`, `PPM`, `ST_PM`).
3. Preview mapping and validation errors.
4. User confirms explicit commit.
5. Persist templates, plans, completions.
6. Build post-import risk report.

### Flow C: Compliance Task Closeout
1. Task enters execution.
2. Performer and qualification checked.
3. Evidence uploaded against policy.
4. Reviewer/approver checks SoD rules.
5. Completion committed.
6. Next due projection recalculated.

### Flow D: Spend Approval
1. Request created with linkage to building/asset/project.
2. Budget and threshold policy evaluated.
3. Multi-step approval executed.
4. Audit entries generated per step.
5. Request finalized and linked to work order/invoice.

## Done Criteria (Core)
1. No cross-tenant leaks in API or DB queries.
2. No regulated closeout without required evidence.
3. No sensitive action without audit entry.
4. No role assignment violating delegated scope.
5. No recurring process dependent on HTTP path.
