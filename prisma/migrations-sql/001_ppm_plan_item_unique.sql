-- 001_ppm_plan_item_unique.sql
--
-- DB-level defence against duplicate PpmPlanItem rows.
--
-- Business key: (tenantId, buildingId, obligationTemplateId, scope, unitId).
-- Because unitId is nullable and Postgres treats NULL as distinct in a plain
-- UNIQUE constraint, a regular @@unique does not protect building_common rows
-- (where unitId IS NULL). The application-level guard in
-- PpmService.createProgram / seedPendingPlanItemsForBuilding catches most
-- duplicates during normal operation, but we need DB enforcement to close
-- the race window.
--
-- Strategy: two PARTIAL unique indexes.
--   a) building-common rows (unitId IS NULL)
--        unique on (tenantId, buildingId, obligationTemplateId, scope)
--   b) unit-scoped rows     (unitId IS NOT NULL)
--        unique on (tenantId, buildingId, obligationTemplateId, scope, unitId)
--
-- Pre-migration cleanup: collapse any existing duplicate groups by keeping
-- the row with the smallest id (deterministic) and deleting the rest along
-- with their now-orphan PpmTemplate rows (nothing points at them anymore).
-- This is safe for pending baselines. If a duplicate group contains a row
-- with baselineStatus != 'pending', keep that one instead — never drop a
-- managed plan item silently.

-- ──────────────────────────────────────────────────────────────
-- STEP 1 — consolidate duplicate building-common rows.
-- ──────────────────────────────────────────────────────────────
-- Tag the "winner" per group. Priority:
--   1. baselineStatus != 'pending' wins (managed > pending)
--   2. earliest createdAt wins
--   3. smallest id wins (tiebreaker)
WITH ranked AS (
  SELECT
    id,
    "templateId",
    row_number() OVER (
      PARTITION BY "tenantId", "buildingId", "obligationTemplateId", "scope"
      ORDER BY
        CASE WHEN "baselineStatus" = 'pending' THEN 1 ELSE 0 END,
        "createdAt" ASC,
        id ASC
    ) AS rn
  FROM ppm_plan_items
  WHERE "unitId" IS NULL
),
losers AS (
  SELECT id, "templateId" FROM ranked WHERE rn > 1
),
del_plan_items AS (
  DELETE FROM ppm_plan_items
  WHERE id IN (SELECT id FROM losers)
  RETURNING "templateId"
)
-- Drop orphan templates that were tied only to the deleted plan items.
-- A template is orphan when no surviving ppm_plan_item references it.
DELETE FROM ppm_templates pt
WHERE pt.id IN (SELECT "templateId" FROM del_plan_items)
  AND NOT EXISTS (
    SELECT 1 FROM ppm_plan_items ppi WHERE ppi."templateId" = pt.id
  );

-- ──────────────────────────────────────────────────────────────
-- STEP 2 — consolidate duplicate unit-scoped rows (same rules).
-- ──────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT
    id,
    "templateId",
    row_number() OVER (
      PARTITION BY "tenantId", "buildingId", "obligationTemplateId", "scope", "unitId"
      ORDER BY
        CASE WHEN "baselineStatus" = 'pending' THEN 1 ELSE 0 END,
        "createdAt" ASC,
        id ASC
    ) AS rn
  FROM ppm_plan_items
  WHERE "unitId" IS NOT NULL
),
losers AS (
  SELECT id, "templateId" FROM ranked WHERE rn > 1
),
del_plan_items AS (
  DELETE FROM ppm_plan_items
  WHERE id IN (SELECT id FROM losers)
  RETURNING "templateId"
)
DELETE FROM ppm_templates pt
WHERE pt.id IN (SELECT "templateId" FROM del_plan_items)
  AND NOT EXISTS (
    SELECT 1 FROM ppm_plan_items ppi WHERE ppi."templateId" = pt.id
  );

-- ──────────────────────────────────────────────────────────────
-- STEP 3 — create the two partial unique indexes.
-- ──────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS ppm_plan_items_unique_scope_no_unit
  ON ppm_plan_items ("tenantId", "buildingId", "obligationTemplateId", "scope")
  WHERE "unitId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ppm_plan_items_unique_scope_unit
  ON ppm_plan_items ("tenantId", "buildingId", "obligationTemplateId", "scope", "unitId")
  WHERE "unitId" IS NOT NULL;
