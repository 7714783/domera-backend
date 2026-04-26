-- 014_contractor_company.sql
--
-- INIT-007 Phase 6 — universal ContractorCompany.
--
-- Adds the contractor_companies table + contractorCompanyId FK columns
-- on cleaning_contractors / task_instances / work_orders. All columns
-- are nullable so existing rows keep working untouched. RLS is enabled
-- on contractor_companies tenant-scoped, matching the rest of the
-- schema.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "contractor_companies" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"  TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "legalName" TEXT,
  "domain"    TEXT         NOT NULL,
  "phone"     TEXT,
  "email"     TEXT,
  "isActive"  BOOLEAN      NOT NULL DEFAULT TRUE,
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contractor_companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contractor_companies_tenantId_name_key"
  ON "contractor_companies" ("tenantId", "name");

CREATE INDEX IF NOT EXISTS "contractor_companies_tenantId_domain_isActive_idx"
  ON "contractor_companies" ("tenantId", "domain", "isActive");

ALTER TABLE "cleaning_contractors"
  ADD COLUMN IF NOT EXISTS "contractorCompanyId" TEXT;
CREATE INDEX IF NOT EXISTS "cleaning_contractors_contractorCompanyId_idx"
  ON "cleaning_contractors" ("contractorCompanyId");

ALTER TABLE "task_instances"
  ADD COLUMN IF NOT EXISTS "contractorCompanyId" TEXT;
CREATE INDEX IF NOT EXISTS "task_instances_contractorCompanyId_idx"
  ON "task_instances" ("contractorCompanyId");

ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "contractorCompanyId" TEXT;
CREATE INDEX IF NOT EXISTS "work_orders_contractorCompanyId_idx"
  ON "work_orders" ("contractorCompanyId");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'app_current_tenant_id') THEN
    EXECUTE 'ALTER TABLE "contractor_companies" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "contractor_companies" FORCE  ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "contractor_companies"';
    EXECUTE 'CREATE POLICY tenant_isolation ON "contractor_companies" USING ("tenantId" = app_current_tenant_id()) WITH CHECK ("tenantId" = app_current_tenant_id())';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_migrator') THEN
    EXECUTE 'GRANT ALL ON TABLE "contractor_companies" TO domera_migrator';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "contractor_companies" TO domera_app';
  END IF;
END $$;
