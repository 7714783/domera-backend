-- 010_tenant_company_admin.sql
--
-- INIT-007 Phase 4 — link BuildingOccupantCompany → User via adminUserId.
--
-- When populated, the referenced User gets TENANT_COMPANY_ADMIN role with
-- scope.tenantCompanyId = this.id via a BuildingRoleAssignment row. The
-- assignment itself is written by the application layer (not the DB) so
-- audit + delegation flow stays in the IamService.
--
-- Idempotent.

ALTER TABLE "building_occupant_companies"
  ADD COLUMN IF NOT EXISTS "adminUserId" TEXT;

CREATE INDEX IF NOT EXISTS "building_occupant_companies_adminUserId_idx"
  ON "building_occupant_companies" ("adminUserId");

-- No FK to users(id) on purpose — we match the existing BuildingOccupantCompany
-- pattern of soft relations managed in the app layer (see createdByUserId
-- columns across the schema that also don't have DB-level FKs).
