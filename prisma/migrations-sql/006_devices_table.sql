-- INIT-002 Phase-5 P1 gap: push-notification device registry.
-- Tenant-scoped with RLS inline so the table ships with isolation on day 1.
-- Master RLS audit (004) doesn't need to be edited because the coverage check
-- tests against schema.prisma + any SQL file in migrations-sql/.

CREATE TABLE IF NOT EXISTS devices (
  id               text PRIMARY KEY,
  "tenantId"       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "userId"         text NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  platform         text NOT NULL,
  "expoPushToken"  text NOT NULL UNIQUE,
  "osVersion"      text,
  "appVersion"     text,
  "lastSeenAt"     timestamptz NOT NULL DEFAULT now(),
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS devices_tenant_user_idx ON devices("tenantId", "userId");
CREATE INDEX IF NOT EXISTS devices_user_idx         ON devices("userId");

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON devices;
CREATE POLICY tenant_isolation ON devices
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
