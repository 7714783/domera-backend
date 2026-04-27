# Team & Roles — QA Checklist (INIT-013)

> Manual verification before declaring INIT-013 done. Each item is a yes/no answered by hand.

## A. Single-source-of-people enforcement

- [ ] Open `/admin/team` — every existing User with a building role appears as a TeamMember (backfill run on PROD).
- [ ] Try to assign a PPM task with an assigneeId that is NOT a TeamMember — server returns 400.
- [ ] Deactivate a TeamMember — every active `TeamMemberRoleAssignment` for that member is expired in DB.

## B. Role catalogue

- [ ] `/admin/roles` lists exactly 24 system roles + N custom (zero on a fresh tenant).
- [ ] System roles cannot be edited via UI (no Edit button on system role detail).
- [ ] System roles cannot be deleted via API (DELETE returns 403).
- [ ] Cloning a system role creates a new custom role with `t_<tenantSlug>_…` key prefix.
- [ ] Creating a custom role with categories=[] returns 400.
- [ ] Creating a custom role with an unknown category (e.g. `categories: ['foobar']`) returns 400.

## C. Role assignment & ABAC scope

- [ ] Assign role to a member with `buildingIds=[B1]` — member appears in eligible-list when query includes `buildingId=B1`, NOT when `buildingId=B2`.
- [ ] Same for floorIds / systemIds.
- [ ] Empty `buildingIds=[]` = unrestricted (member appears for ANY building).
- [ ] Cannot assign the SAME role to the SAME member twice (409 conflict).
- [ ] `canDelegate` blocks a `building_manager` from granting a `workspace_owner` role.

## D. Auto-routing

- [ ] Schedule a PPM task in a workspace with one eligible TeamMember — task lands with `assignmentSource='auto'` and that member's id.
- [ ] Schedule a PPM task in a workspace with ZERO eligible TeamMembers — task lands with `assignmentSource='unassigned'`.
- [ ] When two members are eligible and one has more open tasks, the other is picked (least-loaded).
- [ ] `GET /v1/team/eligible?permission=task.complete&buildingId=…` returns members deterministically (same call → same order).

## E. Workspace switching

- [ ] User with two memberships sees both in the sidebar workspace picker.
- [ ] Switching ROTATES the JWT (new token returned, old one revoked in `sessions` table).
- [ ] After switch, opening the previous workspace's tab and refreshing → redirected to `/login` (token invalid).
- [ ] User attempting to `switch-workspace` to a tenant they DO NOT belong to → 401.
- [ ] Super-admin can switch to any tenant.

## F. Public contractor registry

- [ ] Listing `/v1/public-contractors` returns rows from any workspace (global registry).
- [ ] Creating with the same `publicPhone` as an existing entry returns the existing row (soft dedup).
- [ ] `WorkspaceContractor` for tenant A is invisible to tenant B (RLS).
- [ ] Linking the same `publicContractorId` twice in one tenant returns 409.

## G. CI gates

- [ ] `module-category-coverage` test passes.
- [ ] `ssot-ownership` test passes (legacy iam dual-write listed transitionally).
- [ ] `module-boundaries` passes — `team` and `role-assignments` are in the UNIVERSAL set.
- [ ] `module-rfc` passes — all 5 new modules have `docs/modules/<name>/RFC.md`.
- [ ] `event-contract` passes (no event regressions).

## H. Single-member rule

- [ ] On a fresh workspace with 1 active TeamMember and zero explicit grants, `/v1/auth/me` returns owner-equivalent permissions.
- [ ] Adding a 2nd active member breaks the implicit power — 1st member now needs an explicit role.

## I. UI smoke

- [ ] `/admin/team` lists members with kind chips + role pills.
- [ ] `/admin/team/[id]` shows active grants with scope summary.
- [ ] `/admin/team/new` wizard creates a member of each kind.
- [ ] `/admin/roles` two-tab list works (System / Custom filter).
- [ ] `/admin/roles/new` wizard builds a custom role end-to-end.
- [ ] `/admin/roles/[key]` shows permissions matrix; clone modal works.
- [ ] `/admin/role-assignments` unified list with revoke modal.
- [ ] `/admin/contractors` shows workspace contractors + public registry; Link works.

## J. Sign-off

- [ ] All checks above pass.
- [ ] Backend typecheck green.
- [ ] Frontend typecheck green.
- [ ] Migrations 016 + 017 + 018 applied to PROD via `apply-migrations.mjs`.
- [ ] Dashboard inventory updated with INIT-013 status = `done`.
