<!--
Mandatory checklist enforced by docs/architecture/platform-development-contract.md.
Reviewers WILL request changes if any unticked box is unjustified.
-->

## What changed
<!-- One paragraph. Why this PR exists. -->

## Manual happy-path
<!-- Required. What did you click, what saved, what survived a refresh.
     Skip only for docs-only / config-only PRs and say so explicitly. -->

## Architecture contract checklist

- [ ] **Ownership matrix** — no cross-module entity writes introduced, OR
      `docs/architecture/entity-ownership-ssot.md` updated AND
      `apps/api/test/ssot-ownership.test.mjs` OWNERSHIP map updated.
- [ ] **State machine** — no new request/case statuses introduced, OR
      added to `apps/api/test/state-machine.test.mjs` with explicit allowed
      transitions and guard reasons.
- [ ] **Events** — no new event types, OR added to
      `apps/api/test/event-contract.test.mjs` catalog with payload schema
      and producer/consumer wiring.
- [ ] **Cross-module writes** — none, OR documented as command/event
      with handler test.
- [ ] **Audit** — every sensitive write calls `audit.write()` with
      tenant + actor + before/after metadata.
- [ ] **Tenant isolation** — every new query has `where: { tenantId }`
      or runs through a tenant-scoped Prisma transaction.
- [ ] **RBAC** — every new controller method calls `requireManager` /
      `authorize` / `requirePermission`, OR explicitly bypasses with a
      one-line comment justifying why (e.g. `BYPASS_PATHS`).
- [ ] **New module?** — `docs/modules/<name>/RFC.md` added (template:
      `docs/modules/_template/RFC.md`). RFC delta linked in this PR description.
- [ ] **New entity?** — row added to ownership matrix
      (`docs/architecture/entity-ownership-ssot.md` § Ownership map).
- [ ] **CI gates green** — every test in
      `docs/architecture/platform-development-contract.md` § 9 passes.

## Test plan

<!-- Bulleted list of how a reviewer should verify this works. -->

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
