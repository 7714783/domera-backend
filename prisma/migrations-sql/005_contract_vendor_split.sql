-- Split counterparty on building_contracts: lease-contracts link to an
-- occupant company, service-contracts link to an organization-as-vendor.
-- Previously PPM seed reused building_occupant_companies for vendor rows
-- (companyType='vendor'), polluting the tenants list. This migration:
--   1) makes occupantCompanyId nullable
--   2) adds vendorOrgId (FK → organizations)
--   3) backfills existing vendor-type service contracts into vendorOrgId
--   4) deletes the now-orphaned vendor occupant-company rows

ALTER TABLE "building_contracts"
  ALTER COLUMN "occupantCompanyId" DROP NOT NULL;

ALTER TABLE "building_contracts"
  ADD COLUMN IF NOT EXISTS "vendorOrgId" TEXT;

CREATE INDEX IF NOT EXISTS "building_contracts_vendorOrgId_idx"
  ON "building_contracts"("vendorOrgId");

ALTER TABLE "building_contracts"
  ADD CONSTRAINT "building_contracts_vendorOrgId_fkey"
  FOREIGN KEY ("vendorOrgId") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: for every service contract whose occupantCompany has type
-- 'vendor', find a matching Organization by name (case-insensitive) and
-- copy the FK to vendorOrgId, then null out occupantCompanyId.
DO $$
DECLARE
  rec RECORD;
  orgId TEXT;
BEGIN
  FOR rec IN
    SELECT bc.id AS contract_id, bc."tenantId" AS tenant_id, boc."companyName" AS vname
    FROM "building_contracts" bc
    JOIN "building_occupant_companies" boc ON boc.id = bc."occupantCompanyId"
    WHERE bc."contractType" = 'service'
      AND lower(coalesce(boc."companyType", '')) = 'vendor'
      AND bc."vendorOrgId" IS NULL
  LOOP
    SELECT id INTO orgId FROM "organizations"
    WHERE "tenantId" = rec.tenant_id
      AND lower(name) = lower(rec.vname)
    LIMIT 1;
    IF orgId IS NOT NULL THEN
      UPDATE "building_contracts"
      SET "vendorOrgId" = orgId, "occupantCompanyId" = NULL
      WHERE id = rec.contract_id;
    END IF;
  END LOOP;
END $$;

-- Remove vendor-typed occupant-company rows that no longer have any
-- building_contracts referencing them.
DELETE FROM "building_occupant_companies" boc
WHERE lower(coalesce(boc."companyType", '')) = 'vendor'
  AND NOT EXISTS (
    SELECT 1 FROM "building_contracts" bc
    WHERE bc."occupantCompanyId" = boc.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "building_unit_occupancies" uo
    WHERE uo."occupantCompanyId" = boc.id
  );
