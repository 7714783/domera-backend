-- 021_lease_allocations_rls.sql
--
-- INIT-010 legacy audit — close the lease_allocations RLS gap.
--
-- Background: the table was added in earlier INIT-008 work but RLS
-- policies were not applied. It carried `tenantId` (non-nullable) so
-- application-layer scoping worked, but a bug in the leases service or
-- a manual SQL operation could have leaked allocations across tenants.
--
-- This migration:
--   1. ENABLE + FORCE ROW LEVEL SECURITY.
--   2. Adds the canonical tenant_isolation policy (USING + WITH CHECK
--      against `app.current_tenant_id` GUC).
--
-- After this lands, remove `lease_allocations` from the KNOWN_GAPS set
-- in apps/api/test/rls.migration.test.mjs.
--
-- Idempotent.

ALTER TABLE "lease_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_allocations" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "lease_allocations";
CREATE POLICY tenant_isolation ON "lease_allocations"
  USING (
    "tenantId"::text = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    "tenantId"::text = current_setting('app.current_tenant_id', true)
  );
