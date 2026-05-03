-- 023_building_spaces_elements.sql
-- INIT-012 NS-14 — canonical structural detail tables.
--
-- Adds building_spaces (enclosed serviceable areas) and
-- building_elements (structural details outside the unit grid). Both
-- are tenant-scoped and RLS-protected via the standard pattern
-- (ENABLE + FORCE + tenant_isolation policy). Existing master
-- prisma/rls/001_enable_rls.sql + 003_force_rls.sql don't include
-- these new tables, so we apply RLS inline here.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS building_spaces (
  id            TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  "buildingId"  TEXT NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  "spaceType"   TEXT NOT NULL,
  "floorId"     TEXT,
  "areaSqm"     DOUBLE PRECISION,
  "isShared"    BOOLEAN NOT NULL DEFAULT TRUE,
  "isBookable"  BOOLEAN NOT NULL DEFAULT FALSE,
  "qrLocationId" TEXT,
  notes         TEXT,
  "createdBy"   TEXT DEFAULT 'system',
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT building_spaces_tenant_building_code_key
    UNIQUE ("tenantId", "buildingId", code)
);
CREATE INDEX IF NOT EXISTS building_spaces_tenant_building_type_idx
  ON building_spaces ("tenantId", "buildingId", "spaceType");

CREATE TABLE IF NOT EXISTS building_elements (
  id              TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "buildingId"    TEXT NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  "elementType"   TEXT NOT NULL,
  material        TEXT,
  "installedAt"   TIMESTAMPTZ,
  "warrantyEnd"   TIMESTAMPTZ,
  "conditionState" TEXT DEFAULT 'good',
  notes           TEXT,
  "createdBy"     TEXT DEFAULT 'system',
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT building_elements_tenant_building_code_key
    UNIQUE ("tenantId", "buildingId", code)
);
CREATE INDEX IF NOT EXISTS building_elements_tenant_building_type_idx
  ON building_elements ("tenantId", "buildingId", "elementType");

-- RLS — same shape as every other tenant-scoped table.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE building_spaces ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE building_spaces FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON building_spaces';
  EXECUTE $sql$
    CREATE POLICY tenant_isolation ON building_spaces
      USING ("tenantId" = current_setting('app.current_tenant_id', true))
      WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true))
  $sql$;

  EXECUTE 'ALTER TABLE building_elements ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE building_elements FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON building_elements';
  EXECUTE $sql$
    CREATE POLICY tenant_isolation ON building_elements
      USING ("tenantId" = current_setting('app.current_tenant_id', true))
      WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true))
  $sql$;
END $$;

-- Grant SELECT/INSERT/UPDATE/DELETE to domera_app + ALL to domera_migrator.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON building_spaces TO domera_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON building_elements TO domera_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_migrator') THEN
    EXECUTE 'GRANT ALL ON building_spaces TO domera_migrator';
    EXECUTE 'GRANT ALL ON building_elements TO domera_migrator';
  END IF;
END $$;
