-- 019_team_rls_force.sql
--
-- INIT-013 follow-up — fix RLS gaps left by 016:
--   1. Add FORCE ROW LEVEL SECURITY to the three new tenant-scoped tables.
--      ENABLE alone is not enough — table owners (us, the migrator) bypass
--      RLS without FORCE, so seed scripts running as the owner could read
--      across tenants. FORCE closes that hole.
--   2. Recreate the tenant_isolation policy WITHOUT quotes around the
--      policy name. The canonical form in prisma/rls/001_enable_rls.sql
--      and migrations 002/003 uses unquoted identifiers; the static RLS
--      audit test (rls.migration.test.mjs) expects that exact spelling.
--      The quoted form `"tenant_isolation"` from 016 is functionally
--      equivalent in Postgres but trips the test's regex.
--
-- Idempotent.

-- ── workspace_contractors ─────────────────────────────────────────────
ALTER TABLE "workspace_contractors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "workspace_contractors";
DROP POLICY IF EXISTS tenant_isolation   ON "workspace_contractors";
CREATE POLICY tenant_isolation ON "workspace_contractors"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true));

-- ── team_members ──────────────────────────────────────────────────────
ALTER TABLE "team_members" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "team_members";
DROP POLICY IF EXISTS tenant_isolation   ON "team_members";
CREATE POLICY tenant_isolation ON "team_members"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true));

-- ── team_member_role_assignments ──────────────────────────────────────
ALTER TABLE "team_member_role_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "team_member_role_assignments";
DROP POLICY IF EXISTS tenant_isolation   ON "team_member_role_assignments";
CREATE POLICY tenant_isolation ON "team_member_role_assignments"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true));

-- ── roles — INTENTIONAL RLS EXEMPTION ────────────────────────────────
-- The roles table holds BOTH:
--   · system roles (tenantId IS NULL, isCustom = false) — must be visible
--     to every tenant for the role-builder UI / clone flow.
--   · tenant-custom roles (tenantId = X, isCustom = true) — must be
--     visible only inside tenant X.
--
-- A simple tenant_isolation policy that compares "tenantId" to the GUC
-- would HIDE the system rows from every tenant (they have NULL tenantId).
-- We therefore keep RLS DISABLED on roles and enforce per-tenant write
-- access at the application layer (RolesService validates
-- `r.tenantId === actorTenantId && r.isCustom` on every UPDATE/DELETE).
--
-- The static RLS audit test (rls.migration.test.mjs) carries `roles` in
-- KNOWN_GAPS with a comment pointing here — the exemption is contractual,
-- not accidental.
