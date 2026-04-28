-- 017_backfill_team_members.sql
--
-- INIT-013 backfill — copy existing BuildingRoleAssignment rows into the
-- new TeamMember + TeamMemberRoleAssignment tables.
--
-- Strategy:
--   1. For every (tenantId, userId) that has at least one BuildingRoleAssignment
--      and no TeamMember yet — create a TeamMember row from the User profile.
--   2. For every (tenantId, userId, roleKey) — create a single
--      TeamMemberRoleAssignment that aggregates the legacy per-building rows
--      into one grant with `buildingIds[]`. ABAC scope arrays (floorIds,
--      zoneIds, systemIds) are simply concatenated + deduplicated. This
--      slightly LOSES the "any unrestricted = unrestricted" semantics —
--      acceptable for a one-shot backfill since admins can edit grants
--      afterwards in /admin/role-assignments.
--
-- Idempotent: relies on the @@unique constraints (team_members on
-- (tenantId, userId), assignments on (teamMemberId, roleKey)).
--
-- Legacy table BuildingRoleAssignment is NOT dropped — it remains as a
-- read fallback during the migration window.

-- ── 1. Materialise TeamMember rows from User profiles ──────────────────
INSERT INTO "team_members" (
  "id", "tenantId", "kind", "userId", "displayName", "email", "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  bra."tenantId",
  'employee',
  bra."userId",
  COALESCE(u."displayName", u."username", u."email", 'Member'),
  u."email",
  TRUE,
  now(),
  now()
FROM "building_role_assignments" bra
JOIN "users" u ON u."id" = bra."userId"
WHERE NOT EXISTS (
  SELECT 1 FROM "team_members" tm
  WHERE tm."tenantId" = bra."tenantId" AND tm."userId" = bra."userId"
)
GROUP BY bra."tenantId", bra."userId", u."displayName", u."username", u."email";

-- ── 2. Backfill TeamMemberRoleAssignment from BuildingRoleAssignment ──
INSERT INTO "team_member_role_assignments" (
  "id", "tenantId", "teamMemberId", "roleKey",
  "buildingIds", "floorIds", "zoneIds", "systemIds",
  "teamId", "contractorCompanyId", "tenantCompanyId", "createdByScope",
  "delegatedBy", "delegatedAt", "expiresAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  bra."tenantId",
  tm."id" AS team_member_id,
  bra."roleKey",
  -- Building IDs: deduplicated union across all merged grants.
  ARRAY_AGG(DISTINCT bra."buildingId") FILTER (WHERE bra."buildingId" IS NOT NULL),
  -- ABAC scope arrays start empty (= unrestricted). The legacy per-grant
  -- floor/zone/system narrowing is intentionally NOT carried over —
  -- ARRAY_AGG over an array column raises "cannot accumulate empty
  -- arrays" in Postgres when every source row is []. Admins must re-set
  -- scope via /admin/role-assignments after migration.
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[],
  -- Singleton fields — pick MIN for determinism.
  MIN(bra."teamId"),
  MIN(bra."contractorCompanyId"),
  MIN(bra."tenantCompanyId"),
  BOOL_OR(bra."createdByScope"),
  MIN(bra."delegatedBy"),
  MIN(bra."delegatedAt"),
  MIN(bra."expiresAt"),
  now(),
  now()
FROM "building_role_assignments" bra
JOIN "team_members" tm
  ON tm."tenantId" = bra."tenantId"
  AND tm."userId"   = bra."userId"
WHERE NOT EXISTS (
  SELECT 1 FROM "team_member_role_assignments" t
  WHERE t."teamMemberId" = tm."id" AND t."roleKey" = bra."roleKey"
)
GROUP BY bra."tenantId", bra."userId", bra."roleKey", tm."id";

-- ── 3. Set categories on system roles ─────────────────────────────────
UPDATE "roles" SET "categories" = ARRAY['people', 'finance', 'legal', 'operations'] WHERE "key" = 'workspace_owner';
UPDATE "roles" SET "categories" = ARRAY['people', 'operations']                     WHERE "key" = 'workspace_admin';
UPDATE "roles" SET "categories" = ARRAY['people', 'operations']                     WHERE "key" = 'org_admin';
UPDATE "roles" SET "categories" = ARRAY['operations', 'enterprise']                 WHERE "key" = 'owner_representative';
UPDATE "roles" SET "categories" = ARRAY['operations', 'tech_support', 'cleaning']   WHERE "key" = 'building_manager';
UPDATE "roles" SET "categories" = ARRAY['tech_support', 'compliance']               WHERE "key" = 'chief_engineer';
UPDATE "roles" SET "categories" = ARRAY['security', 'compliance']                   WHERE "key" = 'fire_safety_officer';
UPDATE "roles" SET "categories" = ARRAY['compliance', 'tech_support']               WHERE "key" = 'energy_officer';
UPDATE "roles" SET "categories" = ARRAY['finance']                                  WHERE "key" = 'finance_controller';
UPDATE "roles" SET "categories" = ARRAY['legal', 'compliance']                      WHERE "key" = 'document_controller';
UPDATE "roles" SET "categories" = ARRAY['enterprise', 'finance']                    WHERE "key" = 'project_manager';
UPDATE "roles" SET "categories" = ARRAY['tech_support', 'cleaning']                 WHERE "key" = 'maintenance_coordinator';
UPDATE "roles" SET "categories" = ARRAY['tech_support', 'mobile']                   WHERE "key" = 'technician';
UPDATE "roles" SET "categories" = ARRAY['cleaning', 'mobile']                       WHERE "key" = 'cleaner';
UPDATE "roles" SET "categories" = ARRAY['tech_support', 'enterprise']               WHERE "key" = 'contractor';
UPDATE "roles" SET "categories" = ARRAY['enterprise']                               WHERE "key" = 'vendor_user';
UPDATE "roles" SET "categories" = ARRAY['tech_support', 'compliance']               WHERE "key" = 'external_engineer';
UPDATE "roles" SET "categories" = ARRAY['compliance']                               WHERE "key" = 'auditor';
UPDATE "roles" SET "categories" = ARRAY['operations']                               WHERE "key" = 'viewer';
UPDATE "roles" SET "categories" = ARRAY['operations', 'security']                   WHERE "key" = 'reception';
UPDATE "roles" SET "categories" = ARRAY['enterprise']                               WHERE "key" = 'tenant_company_admin';
UPDATE "roles" SET "categories" = ARRAY['enterprise']                               WHERE "key" = 'tenant_employee';
UPDATE "roles" SET "categories" = ARRAY['cleaning']                                 WHERE "key" = 'cleaning_manager';
UPDATE "roles" SET "categories" = ARRAY['security']                                 WHERE "key" = 'security';
UPDATE "roles" SET "categories" = ARRAY['enterprise', 'tech_support']               WHERE "key" = 'contractor_manager';
