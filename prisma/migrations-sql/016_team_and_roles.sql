-- 016_team_and_roles.sql
--
-- INIT-013 Roles & Team module — foundation tables.
--   · public_contractors (global, NOT tenant-scoped, no RLS)
--   · workspace_contractors (tenant-scoped link table)
--   · team_members (tenant-scoped, primary source of people)
--   · team_member_role_assignments (tenant-scoped role grants)
--   · roles extensions (tenantId, isCustom, description, categories, iconKey)
--
-- Idempotent. Tenant-scoped tables get RLS policies in 016b script.
-- Backfill of existing BuildingRoleAssignment rows lives in 017.

-- ── public_contractors ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public_contractors" (
  "id"                TEXT PRIMARY KEY,
  "displayName"       TEXT NOT NULL,
  "legalName"         TEXT,
  "publicPhone"       TEXT,
  "publicEmail"       TEXT,
  "website"           TEXT,
  "country"           TEXT,
  "city"              TEXT,
  "specialisations"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "licenses"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "ratingAvg"         DOUBLE PRECISION,
  "ratingCount"       INTEGER NOT NULL DEFAULT 0,
  "verificationState" TEXT NOT NULL DEFAULT 'unverified',
  "createdByTenantId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "public_contractors_displayName_idx" ON "public_contractors" ("displayName");
CREATE INDEX IF NOT EXISTS "public_contractors_publicPhone_idx" ON "public_contractors" ("publicPhone");
CREATE INDEX IF NOT EXISTS "public_contractors_publicEmail_idx" ON "public_contractors" ("publicEmail");

-- ── workspace_contractors ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "workspace_contractors" (
  "id"                  TEXT PRIMARY KEY,
  "tenantId"            TEXT NOT NULL,
  "publicContractorId"  TEXT NOT NULL,
  "localDisplayName"    TEXT,
  "localContactPerson"  TEXT,
  "localContactPhone"   TEXT,
  "localContactEmail"   TEXT,
  "privateNotes"        TEXT,
  "preferredRate"       TEXT,
  "internalRatingAvg"   DOUBLE PRECISION,
  "internalRatingCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt"           TIMESTAMP(3),
  "endedAt"             TIMESTAMP(3),
  "status"              TEXT NOT NULL DEFAULT 'active',
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_contractors_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_contractors_public_fkey"
    FOREIGN KEY ("publicContractorId") REFERENCES "public_contractors"("id") ON DELETE RESTRICT,
  CONSTRAINT "workspace_contractors_unique_link" UNIQUE ("tenantId", "publicContractorId")
);
CREATE INDEX IF NOT EXISTS "workspace_contractors_tenantId_idx" ON "workspace_contractors" ("tenantId");
CREATE INDEX IF NOT EXISTS "workspace_contractors_publicContractorId_idx" ON "workspace_contractors" ("publicContractorId");

-- ── team_members ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "team_members" (
  "id"                    TEXT PRIMARY KEY,
  "tenantId"              TEXT NOT NULL,
  "kind"                  TEXT NOT NULL DEFAULT 'employee',
  "userId"                TEXT,
  "workspaceContractorId" TEXT,
  "displayName"           TEXT NOT NULL,
  "email"                 TEXT,
  "phone"                 TEXT,
  "title"                 TEXT,
  "department"            TEXT,
  "photoUrl"              TEXT,
  "isActive"              BOOLEAN NOT NULL DEFAULT TRUE,
  "startDate"             TIMESTAMP(3),
  "endDate"               TIMESTAMP(3),
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "team_members_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "team_members_user_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "team_members_workspace_contractor_fkey"
    FOREIGN KEY ("workspaceContractorId") REFERENCES "workspace_contractors"("id") ON DELETE SET NULL,
  CONSTRAINT "team_members_unique_user_per_tenant" UNIQUE ("tenantId", "userId")
);
CREATE INDEX IF NOT EXISTS "team_members_tenant_active_idx" ON "team_members" ("tenantId", "isActive");
CREATE INDEX IF NOT EXISTS "team_members_tenant_kind_idx" ON "team_members" ("tenantId", "kind");

-- ── roles extensions ──────────────────────────────────────────────────
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "tenantId"    TEXT;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "isCustom"    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "categories"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "iconKey"     TEXT;
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT now();
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'roles_tenant_fkey' AND table_name = 'roles'
  ) THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "roles_tenant_custom_idx" ON "roles" ("tenantId", "isCustom");

-- ── team_member_role_assignments ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "team_member_role_assignments" (
  "id"                  TEXT PRIMARY KEY,
  "tenantId"            TEXT NOT NULL,
  "teamMemberId"        TEXT NOT NULL,
  "roleKey"             TEXT NOT NULL,
  "buildingIds"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "floorIds"            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "zoneIds"             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "systemIds"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "teamId"              TEXT,
  "contractorCompanyId" TEXT,
  "tenantCompanyId"     TEXT,
  "createdByScope"      BOOLEAN NOT NULL DEFAULT FALSE,
  "delegatedBy"         TEXT,
  "delegatedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "expiresAt"           TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "team_member_role_assignments_member_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "team_members"("id") ON DELETE CASCADE,
  CONSTRAINT "team_member_role_assignments_role_fkey"
    FOREIGN KEY ("roleKey") REFERENCES "roles"("key") ON DELETE CASCADE,
  CONSTRAINT "team_member_role_assignments_unique" UNIQUE ("teamMemberId", "roleKey")
);
CREATE INDEX IF NOT EXISTS "tmra_tenantId_idx" ON "team_member_role_assignments" ("tenantId");
CREATE INDEX IF NOT EXISTS "tmra_roleKey_idx"  ON "team_member_role_assignments" ("roleKey");
CREATE INDEX IF NOT EXISTS "tmra_expiresAt_idx" ON "team_member_role_assignments" ("expiresAt");

-- ── RLS for tenant-scoped tables ──────────────────────────────────────
ALTER TABLE "workspace_contractors"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_members"                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_member_role_assignments"    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "workspace_contractors";
CREATE POLICY "tenant_isolation" ON "workspace_contractors"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS "tenant_isolation" ON "team_members";
CREATE POLICY "tenant_isolation" ON "team_members"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS "tenant_isolation" ON "team_member_role_assignments";
CREATE POLICY "tenant_isolation" ON "team_member_role_assignments"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true));

-- public_contractors stays NON-RLS (global registry, public-read from any
-- workspace). Writes are gated by application-level role.manage_global
-- permission (super-admin or workspace_owner). RLS does not apply.

-- Custom roles are tenant-scoped via `tenantId`. The roles table has many
-- system rows (tenantId IS NULL) that must remain readable to every tenant.
-- We therefore DO NOT enable RLS on "roles" — application-layer guards
-- ensure that tenants only mutate their OWN custom rows (isCustom=true and
-- tenantId=current). This mirrors how `permissions` is treated as global.
