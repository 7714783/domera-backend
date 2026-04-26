-- 012_assignment_resolver.sql
--
-- INIT-004 Phase 1 — FloorAssignment + UserAvailability + assignment
-- outcome columns on the three request models. Tenant-scoped on every
-- table; backward compatible with existing rows (all new columns
-- nullable, both new tables empty by default).
--
-- Idempotent.

-- ── FloorAssignment ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "floor_assignments" (
  "id"         TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"   TEXT         NOT NULL,
  "buildingId" TEXT         NOT NULL,
  "floorId"    TEXT         NOT NULL,
  "userId"     TEXT         NOT NULL,
  "roleKey"    TEXT         NOT NULL,
  "primary"    BOOLEAN      NOT NULL DEFAULT FALSE,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"  TEXT,
  CONSTRAINT "floor_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "floor_assignments_tenantId_floorId_userId_roleKey_key"
  ON "floor_assignments" ("tenantId", "floorId", "userId", "roleKey");

CREATE INDEX IF NOT EXISTS "floor_assignments_buildingId_floorId_roleKey_idx"
  ON "floor_assignments" ("buildingId", "floorId", "roleKey");

CREATE INDEX IF NOT EXISTS "floor_assignments_userId_idx"
  ON "floor_assignments" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'floor_assignments_floorId_fkey'
  ) THEN
    ALTER TABLE "floor_assignments"
      ADD CONSTRAINT "floor_assignments_floorId_fkey"
      FOREIGN KEY ("floorId") REFERENCES "building_floors"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── UserAvailability ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_availability" (
  "id"       TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId" TEXT         NOT NULL,
  "userId"   TEXT         NOT NULL,
  "date"     DATE         NOT NULL,
  "status"   TEXT         NOT NULL,
  "reason"   TEXT,
  "setBy"    TEXT,
  "setAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_availability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_availability_tenantId_userId_date_key"
  ON "user_availability" ("tenantId", "userId", "date");

CREATE INDEX IF NOT EXISTS "user_availability_userId_date_idx"
  ON "user_availability" ("userId", "date");

CREATE INDEX IF NOT EXISTS "user_availability_tenantId_date_status_idx"
  ON "user_availability" ("tenantId", "date", "status");

-- ── Assignment outcome columns on existing request tables ─────
ALTER TABLE "incidents"
  ADD COLUMN IF NOT EXISTS "assignedUserId"   TEXT,
  ADD COLUMN IF NOT EXISTS "assignmentSource" TEXT,
  ADD COLUMN IF NOT EXISTS "assignmentReason" TEXT,
  ADD COLUMN IF NOT EXISTS "floorId"          TEXT;
CREATE INDEX IF NOT EXISTS "incidents_assignedUserId_idx" ON "incidents" ("assignedUserId");

ALTER TABLE "service_requests"
  ADD COLUMN IF NOT EXISTS "assignedUserId"   TEXT,
  ADD COLUMN IF NOT EXISTS "assignmentSource" TEXT,
  ADD COLUMN IF NOT EXISTS "assignmentReason" TEXT,
  ADD COLUMN IF NOT EXISTS "floorId"          TEXT;
CREATE INDEX IF NOT EXISTS "service_requests_assignedUserId_idx" ON "service_requests" ("assignedUserId");

ALTER TABLE "cleaning_requests"
  ADD COLUMN IF NOT EXISTS "assignedUserId"   TEXT,
  ADD COLUMN IF NOT EXISTS "assignmentSource" TEXT,
  ADD COLUMN IF NOT EXISTS "assignmentReason" TEXT,
  ADD COLUMN IF NOT EXISTS "floorId"          TEXT;
CREATE INDEX IF NOT EXISTS "cleaning_requests_assignedUserId_idx" ON "cleaning_requests" ("assignedUserId");

-- ── RLS — match the existing prisma/rls/* pattern (app_current_tenant_id())
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'app_current_tenant_id') THEN
    EXECUTE 'ALTER TABLE "floor_assignments"   ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "floor_assignments"   FORCE  ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "floor_assignments"';
    EXECUTE 'CREATE POLICY tenant_isolation ON "floor_assignments" USING ("tenantId" = app_current_tenant_id()) WITH CHECK ("tenantId" = app_current_tenant_id())';

    EXECUTE 'ALTER TABLE "user_availability"   ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "user_availability"   FORCE  ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "user_availability"';
    EXECUTE 'CREATE POLICY tenant_isolation ON "user_availability" USING ("tenantId" = app_current_tenant_id()) WITH CHECK ("tenantId" = app_current_tenant_id())';
  END IF;
END $$;

-- Grants (role-aware — no-op if domera_app/migrator don't exist yet).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_migrator') THEN
    EXECUTE 'GRANT ALL ON TABLE "floor_assignments" TO domera_migrator';
    EXECUTE 'GRANT ALL ON TABLE "user_availability" TO domera_migrator';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "floor_assignments" TO domera_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user_availability" TO domera_app';
  END IF;
END $$;
