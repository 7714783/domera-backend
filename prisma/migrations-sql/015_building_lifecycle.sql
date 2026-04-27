-- 015_building_lifecycle.sql
--
-- INIT-012 Phase 2 — building lifecycle (draft / active / archived).
-- Adds three nullable / defaulted columns. Existing rows default to
-- `active` (current behaviour preserved). New buildings created via the
-- onboarding wizard land as `draft` and are published explicitly.
--
-- Idempotent.

ALTER TABLE "buildings"
  ADD COLUMN IF NOT EXISTS "lifecycleStatus" TEXT NOT NULL DEFAULT 'active';

ALTER TABLE "buildings"
  ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);

ALTER TABLE "buildings"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "buildings_tenantId_lifecycleStatus_idx"
  ON "buildings" ("tenantId", "lifecycleStatus");
