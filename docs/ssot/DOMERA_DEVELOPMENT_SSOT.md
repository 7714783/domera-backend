# Domera — Single Source of Truth (SSOT)

> Canonical development charter for the Domera FM/CMMS SaaS.
> Generated from the full technical specification. Anything contradicting
> this document must be challenged before it is merged.

---

## 1. Executive position

- Domera is **not** a ticketing UI — it is an **FM/CMMS-class management system**
  where operational running of buildings, assets, regulated inspections,
  reactive work, contractors, documents and audit are **one unified model**.
- Foundations: **ISO 41001** (FM management system), **ISO 55000/55001**
  (asset management across the lifecycle).
- **Compliance-ready, not hardcoded by country.** Frequencies, required
  documents, approval matrices, retention policies live in
  **ComplianceProfile** objects scoped to tenant / building / system / equipment.
- Regulatory reference points: SI / ת״י 1525 parts 3 & 4, ASHRAE 180, NFPA 25,
  ISO/IEC 27001, ISO 22301, ISO 19011, GDPR, Israeli PPL + Data Security Regs.
- **Architecture:** modular monolith first, shared DB, single identity / RBAC,
  enforced module boundaries, transactional outbox for inter-module events,
  hybrid-tenancy path for large regulated clients.
- **MVP ≠ everything.** Minimal sufficient MVP:
  Identity/RBAC · Registry · Assets · Documents/Audit · PPM · Reactive Work
  Orders · QR Requests · Basic Inventory · Dashboards.

## 2. Immutable rules

1. `tenant != building`.
2. Modular monolith first; boundaries are enforced; outbox for domain events.
3. Every tenant-owned row carries `tenant_id`; every building-owned row carries `building_id`.
4. PostgreSQL RLS default-deny on all tenant-scoped tables.
5. Sensitive operations must write `AuditEntry` (who/what/when/where/before/after).
6. Recurring + escalation run in workers/queues, never on the HTTP path.
7. REST + OpenAPI 3.1; event channels documented with AsyncAPI; payloads
   validated by JSON Schema; domain events follow CloudEvents.
8. Regulated closeout requires **evidence policy** — no complete without required documents.
9. Separation of duties: requester ≠ final approver, executor ≠ sole closer.
10. Compliance rules live in **ComplianceProfile**, not in business code.
11. Historical facts are distinct from ingest moments: every imported row has
    `occurred_at` + `recorded_at` + `import_batch_id` + `source_*`.
12. Authorization must be testable (unit + integration) — broken access control is the top risk.

## 3. Normative framework matrix

| Source | What it gives | How it lands in the product |
|---|---|---|
| ISO 41001 | FM as a management system (PDCA, KPIs, documented info) | Process catalog, KPIs, review loops, roles, policies |
| ISO 55000 / 55001 | Asset management on the full lifecycle | Asset register, criticality, lifecycle state, capex vs value |
| SI 1525 part 3 | Planned ops for non-residential service systems | Configurable PPM by system type + building |
| SI 1525 part 4 | As-made / evidence documentation | Documents as first-class module with versions & links |
| ASHRAE 180 | Minimum HVAC ITM | HVAC templates + frequency bundles in a ComplianceProfile |
| NFPA 25 | Water-based fire protection ITM | Dedicated frequencies, certificates, evidence types |
| ISO/IEC 27001 | ISMS requirements | Security-by-design, risk register, access governance |
| ISO 22301 | Business continuity | RTO/RPO, DR procedures, quarterly restore drill |
| ISO 19011 | Management system audit guidance | Internal audit workflow & audit programs in the system |
| GDPR | Personal data protection | Data inventory, retention matrix, DSAR, RoPA |
| Israeli PPL + DS Regs | Local data security | Local policies, DB classification, logging, access control |

## 4. Domain model — data families

| Family | Entities | Must store |
|---|---|---|
| Organization & licensing | Organization, ModuleSubscription, BusinessCalendar, ComplianceProfile | tenant scope, enabled modules, tz, locales, numbering rules, calendars, compliance |
| **Mandates** (core) | **BuildingMandate**, DelegatedAdministration | owner_org, operator_org, mandate_type, scope, effective_from/to, contract document |
| Spaces | Building, Floor, Space, LeaseableUnit, UnitComposition, ParkingSpot, StorageUnit, QRLocation | address, level (0 and negative), space type, area, leaseable flag, served floors, merges |
| **Operational profile** | SpaceOperationalProfile, UnitOperationalProfile | finishes, materials, lamp/fixture models, service notes, supported equipment, replacement constraints, maintenance-specific attributes |
| Commercial | TenantCompany, Lease, LeaseAllocation, Vendor, ContractorAgreement | term, leased objects, parking/storage, cost centre, SLA, insurance docs |
| Systems & assets | BuildingSystem, Equipment, EquipmentRelation, ElevatorProfile, SensorPoint, AlarmSource | type, criticality, location, manufacturer, serial, install/commission, warranty, contractor |
| **Workforce** | Employee, ContractorPerson, Shift, Schedule, Availability, Qualification, AssignmentCapacity, ContactChannel | person identity (distinct from role), qualifications + expiry, shift coverage, capacity per day, phone/email/channels |
| Operations | PpmPlan, PpmTask, ChecklistTemplate, ChecklistRun, **Incident**, **ServiceRequest**, WorkOrder, Quote, ApprovalFlow, PurchaseOrder, CompletionRecord | recurrence, due, status, assignees, actuals, cost, approvals, evidence |
| Projects & materials | Project, ProjectStage, ProjectBudgetLine, InventoryItem, StockLocation, StockMovement, Reservation | capex/opex, milestones, balances, reorder, usage by WO |
| Documents, import, audit | Document, DocumentLink, ImportBatch, ImportRowError, AuditEvent, Notification | hash, version, evidence class, source, diff, actor, correlation id |

Key modelling rules:

- Physical geometry ≠ operational logic. `Building` → `Floor (level_no, 0/negatives)`
  → `Space` (generic) → `LeaseableUnit` (+ `UnitComposition` for merges)
  → separate `ParkingSpot`, `StorageUnit`.
- `QRLocation → Space | Equipment`.
- Technical: `BuildingSystem → Equipment` with `EquipmentRelation`.
  `ElevatorProfile` subtype.
  `SensorPoint` + `AlarmSource` with external IDs
  (`bacnet_object_id`, `opc_node_id`, `mqtt_topic`, `haystack_id`, `brick_iri`).
- Operations: separate **plan · instance · approval · evidence**.
- Documents are first-class (hash, version, classification, retention, legal hold).
- Variant attributes via `attributes jsonb` catalog, not per-column sprawl.
- Historical fact columns: `occurred_at`, `recorded_at`, `import_batch_id`,
  `source_system`, `source_file`, `source_row_no`, `import_mode`, `imported_by`,
  `confidence_status`.

### 4.1 Mandate rule (core)

> **Mandate** defines the legal / operational basis under which an organization
> manages a building, part of a building, or a service scope on behalf of an
> owner. Mandate is a first-class core entity — not an RBAC detail and not a
> hidden field inside contracts.

Minimum fields:

| Field | Purpose |
|---|---|
| `owner_org_id` | who owns the asset |
| `operator_org_id` | who operates it (may equal owner) |
| `building_id` (+ optional `scope` — floor, unit, system, service) | what is under the mandate |
| `mandate_type` | `owner`, `management_company`, `service_contract`, `consultant`, `delegated_admin` |
| `effective_from`, `effective_to` | date window |
| `contract_document_id` | evidence |

Mandate distinguishes **ownership**, **operational control**, **vendor
contract** and **delegated administration**. RBAC scope resolution reads
mandates to determine effective authority for an org-user on a building.

### 4.2 Workforce rule

> **Role, person and assignment are distinct concepts.** RBAC expresses
> authority. People are identities. Assignments bind a person to a role, a
> scope and a time window.

Operational workforce management must additionally support:

- `Employee` / `ContractorPerson` — person identity separate from the user account
- `Qualification` with `expires_at` (inspecting electrician, fire officer,
  accredited-lab analyst, etc.)
- `Shift`, `Schedule`, `Availability` — when the person can be assigned
- `AssignmentCapacity` — how many parallel tasks per day/week
- `ContactChannel` — phone / email / WhatsApp for dispatch

An assignment of a PPM task, incident or work order must therefore check:
valid role × valid qualification × shift coverage × remaining capacity.

### 4.3 Operational profile rule

> **Every `Space` and `LeaseableUnit` may carry an Operational Profile.**
> This is a controlled catalog of materials, finishes, service notes,
> supported equipment, replacement constraints and maintenance-specific
> attributes — not a free-form JSON blob.

Examples: `wall_color`, `floor_finish`, `ceiling_type`, `lighting_fixture_type`,
`power_socket_model`, `window_tint`, `brands_allowed`, `allowed_replacement_parts`,
`service_cadence_notes`, `quiet_hours`, `tenant_specific_procedure_ref`.

Implementation: typed attribute catalog + `attributes jsonb` that conforms to
a ComplianceProfile-validated schema. Never a free-for-all JSON.

## 5. Module map + dependencies

```
Identity & RBAC → Organization & Building Registry → Systems & Equipment Registry
  ├── QR & Service Requests
  ├── PPM & Compliance
  ├── Reactive Work Orders
  ├── Projects
  ├── Document Service (cross-cutting)
  ├── Approvals (cross-cutting)
  └── Inventory
Integration Hub wraps the others and publishes via outbox.
```

| Module | MVP? | Depends on | Disableable? | What remains in core |
|---|---|---|---|---|
| Identity / RBAC / SSO | ✓ | — | no | tenants, users, roles, sessions |
| Organization / Building Registry | ✓ | Identity | no | buildings, floors, spaces |
| Systems / Equipment Registry | ✓ | Registry | no | systems, equipment, semantic tags |
| Document Service / Audit | ✓ | Identity, Storage | no | documents, links, history |
| PPM / Compliance | ✓ | Equipment, Docs, Notifications | yes | tasks & history read-only |
| Reactive Work Orders | ✓ | Equipment, Docs, Approvals | yes | WO history read-only |
| QR / Service Requests | ✓ | Registry, WO | yes | request history read-only |
| Inventory | MVP-lite | WO | yes | stock balances / history read-only |
| Projects | later | Docs, Approvals, WO | yes | project history read-only |
| Lease / Tenant Contracting | as-needed | Registry | yes | tenants + lease links |
| Integration Hub | later/lite | core modules + events | yes | external IDs preserved |
| Billing / Payments | optional | Lease or service fees | yes | fiscal history only |

Disable = hide UI + close API + stop jobs/webhooks, **never** delete data.

## 6. Role model (scoped RBAC)

| Role | Base scope | Sees | Does |
|---|---|---|---|
| Platform Superadmin | all tenants | tech state, tenants, billing, flags | tenant lifecycle, support impersonation by procedure |
| Organization Owner | one tenant | entire portfolio | modules, policies, high-level approvals |
| FM Director | tenant / portfolio | all buildings | KPIs, approvals, vendors, projects, compliance |
| Building Manager | one building | everything in building | dispatch, triage, local approvals |
| Technician | assigned scopes | own queue, asset cards, checklists | execute, upload evidence |
| Procurement / Finance | tenant or building | quotes, PO, invoices, budgets | approve, issue PO, cost review |
| Reception / Service Desk | building | incoming requests, SLA queue | triage, reassign, communicate |
| Contractor | assigned jobs only | own assigned WOs | confirm visit, upload docs, actuals |
| Tenant Representative | lease-linked units | own units, own requests | submit / track |
| Auditor / Compliance | read-only scoped | reports, documents, history | export, review, exception notes |

RBAC scopes: tenant · building · module · object ownership · financial threshold
· temporary delegation · substitute approver.

## 7. Role-first dashboards

| Role | Widgets | Actions |
|---|---|---|
| Organization Owner | portfolio risk, compliance heatmap, CAPEX/OPEX, open audits | approve policies, review portfolio |
| FM Director | overdue PPM, emergency incidents, contractor SLA, budget variance | allocate, approve spend |
| Building Manager | today due, active outages, lifts down, pending approvals, tenant issues | triage, dispatch, escalate |
| Technician | my queue, nearest due, checklist shortcuts, spare parts needed | start/stop, upload proof, consume stock |
| Procurement / Finance | quotes awaiting, PO aging, invoices missing docs | approve, PO, push to ERP |
| Reception / Service Desk | open QR, SLA breach risk, reopened tickets | classify, assign, communicate |
| Contractor | assigned jobs, visit schedule, required docs | accept, upload reports/invoices |
| Tenant Representative | my requests, my units, notices | submit, track |

## 8. Hard-stop rules per process

| Process | Cannot close without | Cannot backdate without |
|---|---|---|
| PPM task | performed_at, performed_by, required checklist, mandatory docs | change_reason, changed_by, changed_at, audit event |
| External WO | approved quote + PO + completion docs + actual cost | backfill / import trail |
| Project stage close | signed acceptance pack + budget variance note + handover docs | project audit trail |
| QR request resolve | resolution code + assign/resolve history | reopen history |
| Stock write-off | reason, user, linked object | inventory audit event |

## 9. Process flows

### 9.1 PPM closeout

```
PpmPlan → PpmTask (scheduled) → assigned (internal or contractor)
  → in_progress → checklist + evidence
  → required fields + mandatory docs? → yes → review/acceptance
                                       → no  → docs_pending | failed_validation
  → accepted? yes → completed ; no → rework
```

### 9.2 Reactive — Incident vs ServiceRequest vs WorkOrder

> **Incident ≠ ServiceRequest ≠ WorkOrder.** Incidents are failures /
> emergencies / unsafe conditions. ServiceRequests are asks, complaints,
> soft-service calls. WorkOrders are the executable unit of work. They share
> intake but diverge on SLA, priority, reporting and escalation.

| Aspect | Incident | ServiceRequest | WorkOrder |
|---|---|---|---|
| Origin | BMS alarm, human safety report, QR-incident flag | QR request, tenant portal, reception | derived from Incident / ServiceRequest / PpmTask |
| Default SLA | P1 ≤ 15 min ack; strict MTTR | by service category; elastic | by WO type |
| Escalation | auto-page on-call, emergency override | reassign, complain | normal approval path |
| Reporting | incident register + root-cause + preventive action | service desk KPIs, reopen rate | completion pack + actuals |

```
[ Incident  OR  ServiceRequest ] → triage & classify
  → creates WorkOrder (internal or external)
  → needs contractor/purchase?
      no  → execute as internal WorkOrder
      yes → Quote → ApprovalFlow → approved?
              no  → reject / revise
              yes → PurchaseOrder → execute
                 → completion docs + actuals present?
                     no  → docs_pending
                     yes → close + cost posting
                     (Incident additionally requires root-cause + preventive action before archive)
```

### 9.3 QR request

```
scan QR → auto-detect building/floor/space/equipment
  → category + photo/description → WorkRequest with scope
  → dispatch (internal WO or external Quote → PO)
  → resolve → resident notified
```

### 9.4 Import flow

```
upload xlsx → parse sheets (Regulator / PPM / ST_PM)
  → mapping preview + per-row errors (dry-run)
  → explicit commit → templates / plans / legacy completions persisted
  → post-import risk report (red-list) published via outbox
```

### 9.5 Domain change

```
define invariant impact + affected ComplianceProfile
  → update Prisma schema + migration + RLS policy
  → update service contracts (OpenAPI / AsyncAPI)
  → add policy + audit + SoD checks
  → add authorization + business tests
  → feature flag if risky
```

## 10. API & integration rules

- REST documented via **OpenAPI 3.1**; event channels via **AsyncAPI**; payloads
  validated by **JSON Schema**.
- Every write carries `idempotency_key`.
- Every request / command / event carries `tenant_id`, `correlation_id`,
  `actor_id`, `source`.
- Webhooks are signed and retried.
- Domain events publish **only-after-commit** via transactional outbox.

| Direction | Preferred path | Data | Direction |
|---|---|---|---|
| BMS / BAS | BACnet gateway / OPC UA connector | alarms, points, commands, equipment states | in + selective out |
| IoT / edge | MQTT / HTTPS ingestion | telemetry, health, counters, environmental | in |
| ERP | REST / OData / SFTP CSV | vendors, PO, invoice, cost centre, GL refs | two-way |
| Accounting | REST / batch exports | invoice status, tax docs, payment status, accruals | two-way |
| Identity | OIDC / OAuth 2.0 | auth, SSO, claims, group mapping | in |
| Payments | hosted PSP checkout / webhook | fees, deposits, receipts | two-way |
| Notifications | email / SMS / push | alerts, SLA, approvals | out |
| BI / DW | CDC / events / export API | facts, aggregates, audit exports | out |

## 11. Risk matrix

| Risk | Impact | Mitigation |
|---|---|---|
| Cross-tenant data leak | Critical | tenant context in every layer, RLS default-deny, authz tests, no direct table access |
| Approval workflow bug | High | versioned approval matrix, threshold tests, four-eyes on final approvals |
| Loss of evidence documents | Critical | external object store, hash / version, legal hold, tested restore |
| Uncontrolled backfill | High | import batches, dual timestamps, mandatory source trace, diff review |
| Telemetry explosion | Medium/High | partitioning, retention tiers, raw vs operational summaries |
| Cloud vendor lock-in | Medium | open protocols, S3-compatible, Postgres, OIDC, OpenTelemetry |
| Premature microservices | High | modular monolith first, explicit boundaries, outbox, contracts |
| Weak contractor control | High | contractor scopes, insurance doc expiry alerts, vendor scorecards |
| PCI scope creep | High | hosted PSP checkout, never store card data, signed payment webhooks |
| Wrong local compliance rules | High | ComplianceProfile per jurisdiction, legal sign-off before go-live |

## 12. Success metrics

| Metric | Target | Source |
|---|---|---|
| PPM completion rate | > 90% | DOE O&M Guide |
| Schedule compliance | > 90% | DOE O&M Guide |
| Emergency maintenance share | < 10% of labour | DOE O&M Guide |
| Corrective backlog trend | steady decline | DOE O&M Guide |
| Inventory reconciliation variance | < 2% per cycle | product target |
| P1 acknowledgement | ≤ 15 min | product target |
| Tasks closed with full evidence pack | ≥ 98% | product target |
| Digital adoption (field team) | ≥ 80% | product target |
| Authorization defect leakage | 0 critical to prod | security target |
| Restore drill success | 100% quarterly | resilience target |

## 13. Acceptance criteria

| Area | Scenario | Expected |
|---|---|---|
| Tenant isolation | User of tenant A requests object of tenant B by guessed ID | 404/403 — object never disclosed |
| PPM completion | Technician tries to close a regulatory task without required doc | Close blocked, shows missing evidence |
| Historical import | Inspection from last year is imported | occurred_at historical, recorded_at now, import_batch_id present |
| Reactive closeout | External work closed without PO and completion docs | Close forbidden |
| QR routing | QR scanned in lift lobby | Form pre-knows building / floor / location / equipment |
| Inventory usage | Filter consumed in a WO | Stock decreases, movement visible from both sides |
| Module disablement | Projects disabled for tenant | UI + API hidden, historic data read-only, core links intact |
| Audit trail | PPM plan frequency changed | Before/after diff + actor + timestamp + tenant scope recorded |
| Accessibility | Critical workflow keyboard-only test | Completes without mouse |
| Recovery | Restore document pack + audit events from backup | Meets RTO/RPO |

## 14. Release waves

| Wave | Includes | Deliberately excludes |
|---|---|---|
| Foundation | tenants, users, RBAC, buildings/floors/spaces, document service, audit, notifications, import framework | projects, ERP, advanced analytics |
| Operations Core | systems/equipment, PPM plans/tasks, checklists, ComplianceProfile, dashboards | payments, contractor scoring |
| Field Service | work requests, QR, work orders, quotes, approvals, PO, completion docs, basic inventory | CAPEX projects, deep ERP sync |
| Enterprise Expansion | projects, lease/tenant module, integration hub, SSO, ERP/accounting connectors, BI exports | predictive maintenance ML |
| Scale & Hardening | hybrid tenancy, telemetry optimization, vendor portals, SLA analytics | feature creep outside FM/CMMS core |

## 15. Baseline stack

| Layer | Baseline | Why |
|---|---|---|
| Frontend | Next.js App Router | i18n, tenant-aware routing, SSR/CSR mix |
| Backend | Modular monolith (NestJS TS or .NET) | fast MVP, strict module borders, OpenAPI-first |
| DB | PostgreSQL | RLS, JSONB, FTS, partitioning |
| Queue | one broker (RabbitMQ / SQS / NATS) | notifications, imports, outbox relay, integration retries |
| Files | S3-compatible object storage | scale, versioning, signed URLs |
| Observability | OpenTelemetry + Prometheus + Loki/Grafana | vendor-neutral telemetry |
| CI/CD | GitHub Actions + staging + gated prod | tests, policy checks, migration gates |
| Hosting | existing team platform for MVP | fastest time-to-market |

## 16. Financial model boundaries

> Define, per concept, **what Domera owns as source-of-truth and what it only
> mirrors from ERP/accounting.** No financial object is allowed to grow beyond
> these boundaries without an explicit SSOT amendment.

| Concept | Domera holds | Domera as source-of-truth? | Sync with ERP |
|---|---|---|---|
| Quote | full (requester, vendor, amount, terms, revisions, attached quote docs) | **yes** — Domera is SoT | export quote ID to ERP on PO issue |
| Approval | workflow, steps, decisions, SoD evidence | **yes** — Domera is SoT | export approved amount + signer trail |
| PurchaseOrder | PO number, linked quote, vendor, budget line, status | **yes (operational)** — PO number may be issued by Domera or mirrored from ERP; one authoritative system per tenant, set in tenant config | two-way: PO status & totals |
| Budget & BudgetLine | operational plan (year, category, forecast vs actual) | **operational mirror** — finance cost centres remain in ERP | import cost centre list; export actuals |
| Invoice | vendor invoice metadata + document + match to PO | **no** — Domera stores invoice metadata + attached doc; finalized invoice lives in ERP/accounting | import invoice status, push match result |
| Payment | **not stored by Domera**; delegated to hosted PSP / ERP | no | optional webhook to mark "paid" |
| CAPEX vs OPEX tag | classification per WO / PO / project | yes (classification) | pushed to GL refs |

Rules:

1. **Never store card data.** Payments use a hosted PSP checkout and webhook.
   PCI scope stays out.
2. **One SoT per concept per tenant.** If a tenant's ERP is authoritative for
   PO numbering, Domera's `purchaseOrder.number` is mirrored + read-only; if
   Domera issues, ERP mirrors.
3. **Immutable once signed.** An approved quote, issued PO or posted
   CompletionRecord's cost cannot be edited — only superseded with a new
   versioned record + full audit trail.
4. **Budgets are operational.** Domera's budget is the operational expectation
   vs actuals view; it is not a replacement for the tenant's general ledger.
5. **Invoice finalization is outside Domera.** Domera keeps invoice metadata,
   PO-match result and attached scan — the final accounting record lives in
   ERP/accounting.
6. **Payments module is optional.** Tenants that do not enable Payments
   never see card/deposit flows; fiscal history remains visible if enabled
   once and disabled later.

---

**Non-negotiables:** strict module boundaries, domain-driven contracts, shared
tenant context, RBAC, audit and documents as first-class citizens,
compliance-by-configuration (no hardcoded country logic).
