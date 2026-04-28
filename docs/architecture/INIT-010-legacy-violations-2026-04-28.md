# INIT-010 — Legacy Architecture Audit (2026-04-28)

> Snapshot at start of remediation. Lists every contractual violation that the architectural CI gates currently tolerate via explicit exemptions (`RETRO_RFC_PENDING`, `KNOWN_GAPS`, transitional dual-writer entries in OWNERSHIP, `EXEMPT` map). Each line carries an action — close, document, or rewrite — and a target deadline.
>
> The remediation lands across this PR + scheduled follow-ups. CI gates are tightened so the violation count cannot grow.

## 1. RFC debt — 35 retro-pending modules

`apps/api/test/module-rfc.test.mjs` ships a `RETRO_RFC_PENDING` set that exempts 35 module folders from requiring a `docs/modules/<name>/RFC.md`. Each is a real platform module with operational behaviour but no written architectural record.

| Module | Owner | Action | Priority |
|---|---|---|---|
| auth | platform | RFC required — describes JWT contract + session table | P1 |
| buildings | operations | RFC required — describes building lifecycle + ownership | P1 |
| leases | finance | RFC required — close together with `lease_allocations` RLS | P1 |
| imports | finance | RFC required — bulk-load semantics + dedup | P2 |
| takeover | finance | RFC required | P2 |
| compliance / compliance-profiles | compliance | RFC pair required | P2 |
| documents-related (document-links, document-templates) | legal | RFC required | P2 |
| organizations / occupants / onboarding / tenancy | operations | RFC quartet | P2 |
| ppm-related (calendar-blackouts, condition-triggers, obligations) | tech_support | RFC required | P2 |
| events | platform | RFC critical — outbox contract documented | P1 |
| connectors | tech_support | RFC required — external integration boundary | P2 |
| devices | mobile | RFC required — push token storage + device alias | P2 |
| emergency-overrides | legal | RFC required | P2 |
| health / metrics | platform | RFC required (operational ownership) | P3 |
| inventory | tech_support | RFC required | P2 |
| mfa | people | RFC required — TOTP + backup codes | P2 |
| privacy | legal | RFC required — GDPR/DSAR contract | P1 |
| projects | enterprise | RFC required | P2 |
| public-qr / qr-locations | security | RFC pair — public ingress contract | P2 |
| role-dashboards | people | RFC required | P3 |
| rounds | cleaning | RFC required | P2 |
| scim / sso | people | RFC pair — SCIM + OIDC | P2 |
| seed-runtime | platform | RFC required — dev-only harness | P3 |
| tasks | tech_support / mobile | RFC required — task lifecycle (already partly INIT-002) | P1 |
| vendor-invoices | finance | RFC required | P2 |
| webhooks | platform | RFC required | P3 |

**Remediation in this PR:** write RFCs for the **P1** subset (`auth`, `buildings`, `events`, `tasks`, `leases`, `privacy`). The rest stay in `RETRO_RFC_PENDING` with concrete owner + deadline tracked in `developer-dashboard-data.ts`.

## 2. RLS coverage gap — `lease_allocations`

`apps/api/test/rls.migration.test.mjs` carries `lease_allocations` in `KNOWN_GAPS`. The table has `tenantId` (non-nullable), is written exclusively by the `leases` module, but has no RLS policy. A bug in the leases service or a manual SQL operation could leak allocations across tenants.

**Action**: New migration `021_lease_allocations_rls.sql` adds ENABLE/FORCE/tenant_isolation policy. Remove from `KNOWN_GAPS`.

## 3. Transitional dual-writers in OWNERSHIP

`apps/api/test/ssot-ownership.test.mjs`:

| Entity | Owners | Should be |
|---|---|---|
| `notification` | `['notifications', 'ppm']` | `notifications` only. PPM SLA reminder worker writes legacy in-app rows; needs to publish events instead. |
| `teamMember` | `['team', 'iam']` | `team` only. `IamService.createStaff` is the iam-side writer. |
| `teamMemberRoleAssignment` | `['role-assignments', 'team', 'iam']` | `role-assignments` only. `IamService.assign` / `revoke` write the legacy `BuildingRoleAssignment` table — they should reroute. |
| `taskInstance` | `['ppm', 'tasks', 'seed-runtime']` | `ppm` (creator), `tasks` (lifecycle). Seed-runtime stays as documented dev-only exception. |
| `incident` | `['reactive', 'connectors']` | reactive (canonical), connectors (external integration ingress). Both are legitimate. Document. |
| `serviceRequest` | `['reactive', 'public-qr']` | Same shape as incident. Document. |
| `completionRecord` | `['reactive', 'ppm', 'imports']` | Three legitimate creators. Document. |

**Action**: This PR migrates `IamService` to read from `TeamMemberRoleAssignment` (the new SSOT) instead of `BuildingRoleAssignment`. The legacy table stays as a write-mirror until next PR; ownership entry then collapses to `team` + `role-assignments` only.

PPM SLA notification rewrite is documented as a follow-up — the worker exists in production and refactoring it requires schema review.

## 4. `EXEMPT` legacy delegates — 4 entries to retire

`apps/api/test/ownership-coverage.test.mjs`:

| Entity | Reason | Action |
|---|---|---|
| `maintenancePlan` | "legacy — replaced by ppmPlanItem; no active writers" | Delete the model from schema if no callers. Verify with grep. |
| `sparePart` | "legacy — superseded by AssetSparePart" | Delete the model. |
| `vendor` | "legacy — replaced by Organization with type=vendor" | Delete the model. |
| `residentRequest` | "legacy — superseded by ServiceRequest" | Delete the model. |

**Action**: This PR runs `git grep "prisma.<delegate>\.\b"` for each. If zero callers — delete from schema + emit migration `022_drop_legacy_models.sql`. If callers still exist — promote to OWNERSHIP with the actual writer.

## 5. Schema ↔ DB drift

| Model | Field | Schema | DB (per migration) | Status |
|---|---|---|---|---|
| `NotificationRule` | `tenantId` | `String?` (after fix) | nullable ✓ | **Fixed in this PR** (was `String`, blocked /v1/notifications/rules) |
| Others | — | — | — | TBD — `prisma db pull` against staging would surface more |

**Action**: This PR fixes the known drift. A proper `prisma db pull` audit against PROD is documented as a follow-up — too risky to land in this batch (would ripple changes across many models).

## 6. Audit-trail coverage

Sensitive state changes (status flips on regulated rows) should go through `audit.transition()`. Spot check via grep:

```
prisma\.<model>\.update\(.*status:.*\)
```

vs adjacent `audit.transition(` calls.

**Action**: New CI gate `audit-transition-coverage.test.mjs` that flags `update({ status: ... })` on a curated set of regulated models (`incident`, `serviceRequest`, `approvalRequest`, `cleaningRequest`, `ppmCase`, `workOrder`, `building`, `teamMember`) without an `audit.transition` call within ±20 lines. Initial run will list any gaps as soft warnings; over the next two PRs they get fixed and the gate flips strict.

## 7. Direct cross-module imports outside `UNIVERSAL`

`module-boundaries.test.mjs` already enforces this. Current `UNIVERSAL` set:
`audit · auth · iam · events · role-assignments · team · notifications`.

This is the contractual list. New additions require a module RFC + ssot-ownership entry + dashboard inventory row. No violations in this batch.

## 8. Snapshot drift

`apps/frontend/src/lib/generated/dashboard-snapshot.json` is generated from `scripts/build-dashboard-snapshot.mjs`. Last regen was earlier in this session; new module additions (notifications) are reflected, but new rules / templates seeded via SQL are not — the snapshot script doesn't introspect SQL seed data. Consumer of the snapshot (Executive view) doesn't surface rules/templates anyway, so no immediate gap.

**Action**: re-run snapshot script at end of this PR.

## 9. Frontend dead code (skipped — Vercel limit)

`apps/frontend/src/lib/domera-api.ts` likely carries wrappers for endpoints removed in earlier INITs. Cannot land frontend changes in this PR (Vercel deploy quota). Documented as a follow-up.

## 10. New CI gates added in this PR

- `audit-transition-coverage.test.mjs` — flags sensitive update without audit.transition (warning-mode initially, strict in next PR).
- `legacy-violations.test.mjs` — pins the count of items in `RETRO_RFC_PENDING` + `KNOWN_GAPS` + transitional dual-writer entries. The count cannot grow. Each new violation must be added to this doc + the gate's pinned numbers in the same PR.

## 11. Roadmap

| PR | Scope | Blocked by |
|---|---|---|
| **This PR (INIT-010)** | RFCs P1, lease_allocations RLS, IamService→TeamMemberRoleAssignment read, EXEMPT cleanup, 2 new CI gates, dashboard refresh | — |
| Follow-up A | RFCs P2 (10 modules) | — |
| Follow-up B | PPM SLA worker rewrite (publish event instead of direct notification.create) | INIT-014 phase 2 |
| Follow-up C | `prisma db pull` audit + drift fixes | Staging environment |
| Follow-up D | Frontend `domera-api.ts` cleanup | Vercel quota reset |
| Follow-up E | RFCs P3 (5 modules) | — |
| Follow-up F | Real model deletion (maintenancePlan / sparePart / vendor / residentRequest) | Confirmed zero callers + 1 migration window |

## 12. CI gate counts — before / after

| Gate | Before | After this PR |
|---|---|---|
| state-machine | green | green |
| module-boundaries | green | green |
| event-contract | green | green |
| ssot-ownership | green | green (entries documented in §3) |
| ownership-coverage | green | green (EXEMPT reduced in §4) |
| module-rfc | green (35 retro-pending) | green (29 retro-pending after P1 RFCs) |
| module-category-coverage | green | green |
| rls.migration | green (4 KNOWN_GAPS) | green (3 KNOWN_GAPS — `lease_allocations` closed) |
| notification-contract / mailer-routing / inbound-email-security | green | green |
| env-guard | green | green |
| resend-signature | green | green |
| **audit-transition-coverage** | — | **NEW** (warning) |
| **legacy-violations** | — | **NEW** (pinned) |

Total green gates before: 13. After this PR: 15 (+2 new).
