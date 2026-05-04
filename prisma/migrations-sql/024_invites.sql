-- 024_invites.sql
-- GROWTH-001 NS-19 — invite flow.
--
-- Adds tenant-scoped `invites` table. A manager creates an invite for
-- (email, roleKey, [buildingIds]) → invitee receives a single-use token
-- (72h expiry) → POST /v1/invites/accept consumes it and creates the
-- Membership row. Tokens are stored hashed (sha256) — the plaintext
-- only exists in the email body and the response payload to the
-- inviter. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS invites (
  id            TEXT PRIMARY KEY,
  "tenantId"    TEXT NOT NULL,
  email         TEXT NOT NULL,
  "roleKey"     TEXT NOT NULL,
  "buildingIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tokenHash"   TEXT NOT NULL,
  "invitedBy"   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|expired|revoked
  "expiresAt"   TIMESTAMPTZ NOT NULL,
  "acceptedAt"  TIMESTAMPTZ,
  "acceptedByUserId" TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invites_token_hash_key UNIQUE ("tokenHash")
);

-- Lookup paths the service hits:
--   - findFirst by tokenHash (accept flow) — covered by UNIQUE.
--   - list-by-tenant for the inviter — composite (tenantId, status, createdAt).
--   - dedup-pending-by-email — partial index on (tenantId, email) where status='pending'.
CREATE INDEX IF NOT EXISTS invites_tenant_status_idx
  ON invites ("tenantId", status, "createdAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS invites_tenant_email_pending_uniq
  ON invites ("tenantId", email)
  WHERE status = 'pending';

-- RLS — same shape as every other tenant-scoped table.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE invites ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE invites FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON invites';
  EXECUTE $sql$
    CREATE POLICY tenant_isolation ON invites
      USING ("tenantId" = current_setting('app.current_tenant_id', true))
      WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true))
  $sql$;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON invites TO domera_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_migrator') THEN
    EXECUTE 'GRANT ALL ON invites TO domera_migrator';
  END IF;
END $$;
