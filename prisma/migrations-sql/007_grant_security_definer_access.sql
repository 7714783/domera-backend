-- 007_grant_security_definer_access.sql
--
-- Background: prisma/rls/004_public_qr_rpc.sql creates two SECURITY DEFINER
-- functions (`public_resolve_qr`, `public_qr_building`) owned by
-- `domera_migrator`. They are called by the unauthenticated public-QR
-- landing/submit flow. The functions read from `qr_locations` + `buildings`.
--
-- On Railway PROD the underlying tables ended up owned by `postgres`, not
-- `domera_migrator` (the ownership-transfer in prisma/rls/002_split_roles.sql
-- never finished — likely was applied before some tables were created).
-- Result: SECURITY DEFINER → switch to domera_migrator role → SELECT denied
-- on qr_locations → 500 on every public QR submit. INIT-005 Phase 2.
--
-- Fix: explicit GRANT ALL to domera_migrator on every public-QR-touching
-- table. domera_migrator already has BYPASSRLS so it ignores the policy
-- check; the missing piece was just the table-level grant.
--
-- Idempotent — re-applying GRANT is a no-op if already in place.
--
-- Order-of-apply caveat: this file is in prisma/migrations-sql/ which CI
-- applies BEFORE prisma/rls/* (where domera_migrator is created). To stay
-- applicable in both orders, we wrap the GRANTs in a role-existence check —
-- no-op when the role hasn't been created yet (rls/* will fix the grants
-- on its own in that case).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'domera_migrator') THEN
    EXECUTE 'GRANT ALL ON TABLE qr_locations TO domera_migrator';
    EXECUTE 'GRANT ALL ON TABLE buildings TO domera_migrator';
    EXECUTE 'GRANT ALL ON TABLE building_floors TO domera_migrator';
    EXECUTE 'GRANT ALL ON TABLE building_units TO domera_migrator';
    EXECUTE 'GRANT ALL ON TABLE service_requests TO domera_migrator';
  END IF;
END $$;
