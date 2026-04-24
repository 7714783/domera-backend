-- 008_task_notes.sql
--
-- INIT-002 Phase 5 P1 — mobile-facing TaskNote table.
-- Technician on-site adds short notes against a task (problem ran late,
-- part replaced, customer not home). Tenant-scoped via parent TaskInstance.
-- FK ON DELETE CASCADE so removing a task removes its notes too.
--
-- Idempotent. Role-aware: GRANTs + the RLS policy that uses
-- app_current_tenant_id() only run if the matching role / function exists,
-- so this file is safe to apply BEFORE prisma/rls/* in CI.

CREATE TABLE IF NOT EXISTS "task_notes" (
  "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"       TEXT         NOT NULL,
  "taskInstanceId" TEXT         NOT NULL,
  "authorUserId"   TEXT         NOT NULL,
  "body"           TEXT         NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "task_notes_taskInstanceId_createdAt_idx"
  ON "task_notes" ("taskInstanceId", "createdAt");

CREATE INDEX IF NOT EXISTS "task_notes_tenantId_idx"
  ON "task_notes" ("tenantId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_notes_taskInstanceId_fkey'
  ) THEN
    ALTER TABLE "task_notes"
      ADD CONSTRAINT "task_notes_taskInstanceId_fkey"
      FOREIGN KEY ("taskInstanceId") REFERENCES "task_instances"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "task_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_notes" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_notes_tenant_isolation ON "task_notes";

-- Policy uses app_current_tenant_id() created by prisma/rls/001_enable_rls.sql.
-- If the function isn't there yet (CI applies migrations before rls/*),
-- create a placeholder policy that we'll drop+recreate when rls/* runs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'app_current_tenant_id') THEN
    EXECUTE $POLICY$
      CREATE POLICY task_notes_tenant_isolation ON "task_notes"
        USING ("tenantId" = app_current_tenant_id())
        WITH CHECK ("tenantId" = app_current_tenant_id())
    $POLICY$;
  ELSE
    -- Default-deny placeholder. Replaced by the real policy when prisma/rls/
    -- runs (it does DROP POLICY IF EXISTS first).
    EXECUTE $POLICY$
      CREATE POLICY task_notes_tenant_isolation ON "task_notes"
        USING (false) WITH CHECK (false)
    $POLICY$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_migrator') THEN
    EXECUTE 'GRANT ALL ON TABLE "task_notes" TO domera_migrator';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "task_notes" TO domera_app';
  END IF;
END $$;
