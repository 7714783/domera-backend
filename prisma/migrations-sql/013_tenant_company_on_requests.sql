-- 013_tenant_company_on_requests.sql
--
-- INIT-007 Phase 4 finalisation — adds tenantCompanyId to the three
-- request models (incidents, service_requests, cleaning_requests). Lets
-- TENANT_COMPANY_ADMIN see only their company's requests and the
-- AssignmentResolver eventually consider company-scoped routing.
--
-- Backward compatible: column is nullable, no FK constraint (we follow
-- the schema-wide pattern of UUID strings without DB-level FKs to
-- BuildingOccupantCompany). Existing rows stay NULL = "not associated
-- with any company".
--
-- Idempotent.

ALTER TABLE "incidents"
  ADD COLUMN IF NOT EXISTS "tenantCompanyId" TEXT;
CREATE INDEX IF NOT EXISTS "incidents_tenantCompanyId_idx"
  ON "incidents" ("tenantCompanyId");

ALTER TABLE "service_requests"
  ADD COLUMN IF NOT EXISTS "tenantCompanyId" TEXT;
CREATE INDEX IF NOT EXISTS "service_requests_tenantCompanyId_idx"
  ON "service_requests" ("tenantCompanyId");

ALTER TABLE "cleaning_requests"
  ADD COLUMN IF NOT EXISTS "tenantCompanyId" TEXT;
CREATE INDEX IF NOT EXISTS "cleaning_requests_tenantCompanyId_idx"
  ON "cleaning_requests" ("tenantCompanyId");
