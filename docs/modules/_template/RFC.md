# Module RFC — `<module-name>`

> Copy this file when starting a new module. Path: `docs/modules/<module-name>/RFC.md`.
> CI gate `module-rfc.test.mjs` rejects any new `apps/api/src/modules/<X>/`
> folder without a corresponding RFC.

## 1. Why this module exists

One short paragraph. What user pain does it solve? What measurable outcome does it move?

## 2. Scope and non-scope

### In scope
- Bullet 1
- Bullet 2

### Out of scope (explicitly)
- Bullet 1
- Bullet 2

## 3. Owned entities (writes)

Prisma model → table name. Add a row for every entity this module CREATES, UPDATES, or DELETES.

| Model | Table | Notes |
|---|---|---|
| `Foo` | `foos` | created here, immutable elsewhere |

If this module owns nothing (read-only / aggregator), say so explicitly: "This module owns no entities; it reads `Asset` and emits `<event-type>`."

## 4. Reads (no writes)

Models the module reads but does NOT write. This is the cross-module read surface — referenced by FK or joined.

| Model | Why we read | How we read (FK / list) |
|---|---|---|

## 5. Incoming events (subscriptions)

| Event type | Producer | Why we subscribe | Effect on our state |
|---|---|---|---|

If none, say "This module is a leaf — no inbound events."

## 6. Outgoing events (publications)

| Event type | Schema version | Payload top-level keys | Consumers |
|---|---|---|---|

Every entry MUST also be in [`apps/api/test/event-contract.test.mjs`](../../../apps/api/test/event-contract.test.mjs) `CATALOG`.

## 7. Workflow states (state machine)

If this module has any case-like entity (Request, Case, WorkOrder, Approval, …):

```
state-A --[ trigger / guard ]--> state-B
```

Every state and every transition MUST also be in [`apps/api/test/state-machine.test.mjs`](../../../apps/api/test/state-machine.test.mjs) `REGISTRY`. Terminals (`closed`, `cancelled`, `archived`, `done`, `fulfilled`, …) have no outgoing edges.

If no state machine: say "This module has no workflow state — operations are atomic CRUD."

## 8. Failure / rollback rules

What happens when:
- A handler throws mid-transaction?
- An event consumer fails repeatedly?
- A user's action fails the guard checks listed above?

If the answer is "nothing special", say so — the explicit "nothing" is acceptable; an empty section is not.

## 9. Audit points

Every sensitive write calls `audit.write()` with:
- `actor` (userId)
- `action` (e.g. "PPM case opened")
- `entityType` + `resourceId`
- `metadata` containing before/after when relevant

List the explicit audit calls this module emits.

## 10. RBAC + scope

| Endpoint / action | Required permission | Scope dimension(s) |
|---|---|---|

If the module is fully manager-gated, say so: "All endpoints call `requireManager`."

## 11. Tenant isolation

Every Prisma query in this module:
- runs through `PrismaService` (auto `set_config('app.current_tenant_id', …)`), OR
- uses `MigratorPrismaService` only at well-justified boundaries (public-QR, seeds), with a comment.

Confirm this module follows the rule. If not, link the exception.

## 12. Definition of Ready (DoR) checklist

Tick these before marking the module 🟢 in [modules-inventory](../../architecture/modules-inventory-2026-04-26.md):

- [ ] Backend endpoint(s) exist and return real data
- [ ] Frontend renders that real data (no mock arrays in production UI)
- [ ] Data persists in DB; survives page refresh
- [ ] Tenant isolation enforced
- [ ] RBAC enforced
- [ ] Manual happy-path documented in [PR description](#) of the merge PR
- [ ] State machine in `state-machine.test.mjs` REGISTRY
- [ ] Outgoing events in `event-contract.test.mjs` CATALOG
- [ ] No cross-module direct writes (`ssot-ownership.test.mjs` green)
- [ ] No cross-module direct service imports without registered NestModule
      (`module-boundaries.test.mjs` green)

## 13. Open questions

(empty when published)
