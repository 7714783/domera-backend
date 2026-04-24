-- Per-tenant (occupant company) preferences + service entitlements.
-- 1:1 with building_occupant_companies. Stores values that differ between
-- tenants sharing the same building.

CREATE TABLE IF NOT EXISTS "occupant_company_settings" (
  "id"                   TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId"             TEXT    NOT NULL,
  "occupantCompanyId"    TEXT    NOT NULL,
  "cleaningFrequency"    TEXT    NOT NULL DEFAULT 'daily',
  "cleaningSlaHours"     INTEGER NOT NULL DEFAULT 24,
  "cleaningZone"         TEXT,
  "parkingCount"         INTEGER NOT NULL DEFAULT 0,
  "storageCount"         INTEGER NOT NULL DEFAULT 0,
  "insuranceRequired"    BOOLEAN NOT NULL DEFAULT TRUE,
  "insuranceExpiresAt"   TIMESTAMP(3),
  "accessCardCount"      INTEGER NOT NULL DEFAULT 0,
  "allowsAfterHours"     BOOLEAN NOT NULL DEFAULT FALSE,
  "billingEmail"         TEXT,
  "preferredLanguage"    TEXT    NOT NULL DEFAULT 'en',
  "notificationChannels" TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"                TEXT,
  "customFields"         JSONB,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "occupant_company_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "occupant_company_settings_occupantCompanyId_key"
  ON "occupant_company_settings"("occupantCompanyId");

CREATE INDEX IF NOT EXISTS "occupant_company_settings_tenantId_idx"
  ON "occupant_company_settings"("tenantId");

ALTER TABLE "occupant_company_settings"
  ADD CONSTRAINT "occupant_company_settings_occupantCompanyId_fkey"
  FOREIGN KEY ("occupantCompanyId") REFERENCES "building_occupant_companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "occupant_company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "occupant_company_settings" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "occupant_company_settings";
CREATE POLICY tenant_isolation ON "occupant_company_settings"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
