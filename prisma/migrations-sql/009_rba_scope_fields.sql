-- 009_rba_scope_fields.sql
--
-- INIT-007 Phase 1 — ABAC scope narrowing on BuildingRoleAssignment.
--
-- Adds 5 nullable columns + one boolean toggle + 3 indexes so role grants
-- can narrow past (tenantId, buildingId). Semantics:
--
--   floorIds      []  — empty array == unrestricted within buildingId
--   zoneIds       []  — empty array == unrestricted
--   systemIds     []  — empty array == unrestricted
--   teamId        NULL == unrestricted
--   contractorCompanyId  NULL == unrestricted
--   tenantCompanyId      NULL == unrestricted
--   createdByScope       FALSE == not self-service scoped
--
-- Backward compatible: existing rows get default NULL / empty array / FALSE
-- so every current guard check keeps passing exactly as before. The guard
-- layer (apps/api/src/common/authz) is what makes these fields actually
-- restrict access — this migration is schema-only.
--
-- Idempotent.

ALTER TABLE "building_role_assignments"
  ADD COLUMN IF NOT EXISTS "floorIds"            TEXT[]  NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS "zoneIds"             TEXT[]  NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS "systemIds"           TEXT[]  NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS "teamId"              TEXT,
  ADD COLUMN IF NOT EXISTS "contractorCompanyId" TEXT,
  ADD COLUMN IF NOT EXISTS "tenantCompanyId"     TEXT,
  ADD COLUMN IF NOT EXISTS "createdByScope"      BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS "building_role_assignments_teamId_idx"
  ON "building_role_assignments" ("teamId");

CREATE INDEX IF NOT EXISTS "building_role_assignments_contractorCompanyId_idx"
  ON "building_role_assignments" ("contractorCompanyId");

CREATE INDEX IF NOT EXISTS "building_role_assignments_tenantCompanyId_idx"
  ON "building_role_assignments" ("tenantCompanyId");
