-- 011_fix_rls_guc_names.sql
--
-- INIT-008 Phase 1 — rewrite PROD RLS policies that were originally created
-- in 002_building_unit_groups.sql + 003_occupant_company_settings.sql with
-- the wrong GUC name (`app.tenant_id`). The runtime sets
-- `app.current_tenant_id` (prisma.service.ts + withTenant) and every other
-- RLS policy in prisma/rls/001_enable_rls.sql reads that name. The two
-- mismatched policies evaluated current_setting(...) to NULL and
-- silently turned into deny-all, so no user could see their own
-- building_unit_groups / occupant_company_settings rows — even though
-- the application layer wrote them correctly.
--
-- This migration drops the bad policies and recreates them with the
-- canonical GUC name. 002 / 003 are also rewritten in-place so fresh
-- CI runs (migrations-apply on an empty DB) produce the correct state.
--
-- Idempotent — DROP POLICY IF EXISTS + CREATE POLICY is safe on re-run.

DROP POLICY IF EXISTS tenant_isolation ON "building_unit_groups";
CREATE POLICY tenant_isolation ON "building_unit_groups"
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "occupant_company_settings";
CREATE POLICY tenant_isolation ON "occupant_company_settings"
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
