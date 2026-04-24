-- Combined office (unit group): 2+ BuildingUnits treated as one rented space
-- by the same occupant company. Ungroup = SET NULL on building_units.groupId.

CREATE TABLE IF NOT EXISTS "building_unit_groups" (
  "id"                TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"          TEXT        NOT NULL,
  "buildingId"        TEXT        NOT NULL,
  "groupCode"         TEXT        NOT NULL,
  "name"              TEXT        NOT NULL,
  "occupantCompanyId" TEXT,
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "building_unit_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "building_unit_groups_buildingId_groupCode_key"
  ON "building_unit_groups"("buildingId", "groupCode");

CREATE INDEX IF NOT EXISTS "building_unit_groups_tenantId_buildingId_idx"
  ON "building_unit_groups"("tenantId", "buildingId");

CREATE INDEX IF NOT EXISTS "building_unit_groups_occupantCompanyId_idx"
  ON "building_unit_groups"("occupantCompanyId");

ALTER TABLE "building_unit_groups"
  ADD CONSTRAINT "building_unit_groups_buildingId_fkey"
  FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "building_unit_groups"
  ADD CONSTRAINT "building_unit_groups_occupantCompanyId_fkey"
  FOREIGN KEY ("occupantCompanyId") REFERENCES "building_occupant_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "building_units" ADD COLUMN IF NOT EXISTS "groupId" TEXT;

CREATE INDEX IF NOT EXISTS "building_units_groupId_idx" ON "building_units"("groupId");

ALTER TABLE "building_units"
  ADD CONSTRAINT "building_units_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "building_unit_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "building_unit_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_unit_groups" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "building_unit_groups";
CREATE POLICY tenant_isolation ON "building_unit_groups"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
