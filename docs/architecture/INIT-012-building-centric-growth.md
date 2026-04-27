# INIT-012 — Building-Centric Growth Program

> **Status:** in_progress (P0). **Created:** 2026-04-26.
> **Companion:** [legacy-architecture-audit-2026-04-26.md](legacy-architecture-audit-2026-04-26.md) is the diagnosis; this is the prescription.
>
> **Goal:** make the system grow systemically. One canonical entity per concept; owner-only writes; event-driven cross-module sync; predictable workflows. The chiller is the canary — it must travel cleanly Assets → PPM → Approval → Contractor → Invoice → Close, with the asset card auto-updated via event after every PPM cycle.

## Three waves

| Wave | Focus | Dependency on prior wave |
|---|---|---|
| **P0 Foundation** | Close architectural gaps so the contract is enforceable | None — start immediately |
| **P1 Workflows** | Wire the canonical end-to-end flows (PPM full case, unified inbox, QR cleaning) on top of the closed foundation | All P0 closed |
| **P2 Scale** | Standardise the remaining modules, polish UX, harden edges | P1 closed |

## Acceptance — when the program is "done"

1. **Chiller end-to-end:** create a chiller in Assets → PPM schedules a quarterly check → inspector opens case → check fails → expense request → manager approval → contractor dispatched → completion + invoice → case closed → asset card timeline shows the maintenance event.
2. **Event-driven asset updates:** after the PPM case closes, the assets module learns about the new maintenance record via the `ppm.case.closed` event subscriber, NOT through a direct cross-module write.
3. **Cleaning QR end-to-end:** resident scans QR → request created → cleaner gets push notification → does the work → resident notification.
4. **Architecture CI gates all green:** ssot-ownership, ownership-coverage, module-boundaries, state-machine, event-contract, module-rfc, rbac-matrix, rls.migration, authz-policy, locations.contract — zero ownership violations, zero exception list growth.

---

## Wave P0 — Foundation (in flight, INIT-010 + INIT-011 inherits)

| # | Module | Task | Acceptance | Status |
|---|---|---|---|---|
| 1 | infrastructure | Close OWNERSHIP map gap — every Prisma delegate either in OWNERSHIP or EXEMPT | `ownership-coverage.test.mjs` green; 127 models classified | ✅ done (INIT-010 P1) |
| 2 | condition-triggers | Remove direct write to TaskInstance; route through PpmService.createTaskFromTrigger() (interim) | `prisma.taskInstance.create` does not appear in condition-triggers | ✅ done (INIT-010 P1) |
| 3 | audit | Introduce `audit.transition(...)` and cover sensitive status transitions in approvals/reactive/cleaning | every `prisma.<X>.update({status})` in those four modules has a follow-up `audit.transition` | ✅ done (INIT-010 P1) |
| 4 | top-12 modules | Land the first wave of RFCs | docs/modules/<name>/RFC.md exists for assets, ppm, reactive, cleaning, approvals, building-core, iam, audit, assignment, contractor-companies, tenant-companies, documents | ✅ done (INIT-010 P1) |

P0 is complete. **The contract is now enforceable.**

---

## Wave P1 — Canonical workflows (next)

### Building + structure

| Module | Task | Acceptance |
|---|---|---|
| **buildings** | Introduce `draft → active → archived` lifecycle on Building + completeness score | Building is created as `draft`; published to `active` via explicit transition; every transition writes audit |
| **building-core** | Introduce canonical `BuildingSpace` + `BuildingElement` (roof/basement/facade/doors/tech-rooms/garden) — non-leasable structural detail beyond Floor/Unit | New structural details added without altering the buildings table |
| **onboarding** | Wizard `core → structure → systems/elements` with draft save | A user can build the skeleton of a building and resume hours later without data loss |
| **buildings (frontend)** | "Building Passport + Structure + Systems" — single coherent UX instead of scattered forms | Non-programmer can set up a building in one flow, no chaos |

### Asset + documents

| Module | Task | Acceptance |
|---|---|---|
| **assets** | Lock canonical chiller-style asset card: `installDate`, warranty window, location, attribute versioning (so changes are tracked over time) | Chiller created in `assets` is reachable from PPM/Reactive/Documents by a single `assetId` |
| **document-links** | Standardise polymorphic DocumentLink for `asset / ppm_case / work_order / approval` | One Document linked to multiple subjects with no duplication |
| **documents** | Evidence-pack rules per work type — required document set | Cannot close a case without the mandatory document bundle |
| **document-templates** | PPM + contractor checklist/act templates with version pinning | Document creation in PPM goes via template; version is pinned on save |

### PPM + approvals + reactive (the canonical case lifecycle)

| Module | Task | Acceptance |
|---|---|---|
| **ppm** | Full case workflow: `open → assign → inspect → pass/fail → expense/approval → contractor → invoice → close` | Case closes only when all mandatory steps + evidence are present |
| **approvals** | Approval types for PPM expense / quote / PO with SoD | PPM expenses cannot proceed without the right role's approval |
| **reactive** | Unified "extra-work after inspection" branch: `SR/Incident → WO → Quote → PO → Completion` | All transitions valid per state machine; every step audited |
| **vendor-invoices** | Link invoice to `ppm_case / work_order / purchase_order` | Final case closure requires confirmed invoice/payment |
| **inventory** | Spare-part write-offs / consumption inside a PPM case | Materials reflected in the case AND in stock movements |
| **tasks** | Unified Inbox — PPM + Cleaning + Reactive in one screen | Operator sees all assigned tasks regardless of source |

### Cleaning + public

| Module | Task | Acceptance |
|---|---|---|
| **cleaning** | Short flow: `QR → request → push cleaner → done → notify resident` | Resident-driven request goes end-to-end without manual intervention |
| **public-qr** | Standardise public entrypoints for cleaning + reactive submission | Public endpoints respect tenant isolation and write audit events |
| **assignment** | Single resolver for PPM/Reactive/Cleaning assignment | Assignment is reproducible from `(scope, floor, role, availability)` |

### Identity + scope

| Module | Task | Acceptance |
|---|---|---|
| **iam** | Finalise role × scope matrix for building / floor / system / team | Access checks match the role matrix exactly |
| **tenant-companies** | Apply tenant-company scope across requests + access | Tenant-company narrows are applied uniformly |
| **occupants** | Normalise `Occupant → Unit / Group / Contract` relations | No duplicate occupant data across modules |
| **leases** | Fix lease/service contract as the source of commercial obligations | Contract data is referenced (not copied) by approvals/finance |

### Cross-module plumbing

| Module | Task | Acceptance |
|---|---|---|
| **condition-triggers** | Become publish-only — emit `condition.triggered` event; ppm subscribes | Module no longer writes to any non-owned entity |
| **events** | Wire real outbox delivery for inter-module sync | `building / asset / ppm` events delivered; read-models updated by subscribers |
| **webhooks** | External notifications on key case events | External status updates only fire after the producing transaction commits |
| **connectors** | Normalise inbound integrations into canonical commands | Inbound integrations do NOT bypass owner modules |

---

## Wave P2 — Scale + polish

| Module | Task | Acceptance |
|---|---|---|
| **audit** | (Already shipped in P0; extend with audit-coverage CI guard in P2) | grep guard catches `prisma.<X>.update({status})` without follow-up audit.transition |
| **compliance-profiles** | Bind PPM/document obligations to profile rules | Frequency / required docs / checklists driven by the profile, not hardcoded |
| **obligations** | Link obligations to asset / system / category / PPM seed | Each relevant asset auto-gets its obligations plan |
| **calendar-blackouts** | Include blackout rules in PPM next-due calculation | Next-due correctly shifts past Shabbat / Pesach / custom blackouts |
| **projects** | Branch large work from PPM into project/capex | Escalation to a project does not break the underlying PPM case |
| **privacy** | Documents + cases respect retention + DSAR scope | Delete/export honours retention; audit unbroken |
| **auth** | Production guardrails + session + idempotency handling | No unsafe bypass paths in write endpoints |
| **tenancy** | Single tenant extractor/decorator across controllers | No header-fallback drift; uniform context |
| **sso** | Enterprise users land with correct building scopes | SSO users get the right roles + scope |
| **scim** | Auto-provision roles + memberships per RBAC contract | No "orphan" SCIM accounts without scope |
| **mfa** | Step-up on critical operations (approval / payment / role change) | Critical actions require strong-auth |
| **organizations** | Normalise owner / operator / vendor wiring on buildings | Org roles used consistently in workflows |
| **developer-dashboard** | Per-module: owns / writes / reads / events / state / audit gaps | Risk + ownership are visible at a glance |

---

## Rolling backlog → INIT-012 phases

The dashboard tracks INIT-012 with three matching phases:

- **Phase 1 — P0 Foundation** ✓ DONE (inherited from INIT-010 P1)
- **Phase 2 — P1 Workflows** (in flight)
- **Phase 3 — P2 Scale + polish**

Each module-level task above turns into an issue (or PR-sized chunk) tagged with its INIT-012 phase. Module RFCs get updated when the phase ships — every new behaviour shows up in the relevant section (states / events / audit).

## Hard "do not touch"

- No new parallel entity for an existing concept. If a module needs a place to put data, **read** the canonical entity or **publish** an event so the owner stores it.
- No direct writes to another module's entity. Period. The exception list (in `apps/api/test/ssot-ownership.test.mjs`) does not grow without architecture-owner approval.
- No "we'll add the audit later." Sensitive transitions land **with** their `audit.transition` call, not in a follow-up PR.

## How to run the canary test

After any P1 task lands:

```
1. Create chiller via Assets UI → POST /v1/buildings/<slug>/assets
2. PPM schedule auto-attaches → /v1/buildings/<slug>/ppm/calendar shows quarterly check
3. Open case → assign → inspector marks failed
4. ppm.expense.requested event → ApprovalRequest created
5. Manager approves → approval.granted event → reactive creates WorkOrder + Quote
6. Contractor completes → completion.recorded event → ppm advances + assets updates timeline
7. Vendor invoice issued + paid → invoice.paid event → ppm advances to closed
8. /v1/assets/:id detail shows the maintenance record on its timeline
```

When this passes, INIT-012 P1 is done.
