-- 008_task_notes.sql
--
-- INIT-002 Phase 5 P1 — mobile-facing TaskNote table.
-- Technician on-site adds short notes against a task (problem ran late,
-- part replaced, customer not home). Tenant-scoped via parent TaskInstance.
-- FK ON DELETE CASCADE so removing a task removes its notes too.
--
-- Idempotent.

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
CREATE POLICY task_notes_tenant_isolation ON "task_notes"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

GRANT ALL ON TABLE "task_notes" TO domera_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "task_notes" TO domera_app;
