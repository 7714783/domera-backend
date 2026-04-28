-- 022_drop_legacy_models.sql
-- INIT-010 Follow-up F (2026-04-28).
--
-- Drops three legacy tables that have zero application-level writers:
--   · maintenance_plans  — superseded by ppm_plan_items (PPM module)
--   · resident_requests  — superseded by service_requests (reactive module)
--   · spare_parts        — superseded by asset_spare_parts (assets module)
--
-- Audit performed via grep for `prisma.<delegate>.` against apps/, gh/, and
-- scripts/ — no live callers found. Schema models removed in the same PR.
-- The Vendor model is intentionally KEPT (still has live writers in the
-- connectors module + a Contract.vendorId FK); ownership reclassified
-- from EXEMPT to OWNERSHIP[connectors] in the same PR.
--
-- Idempotent: IF EXISTS guards make repeated runs safe in CI sandbox /
-- staging / freshly-seeded dev databases.

drop table if exists maintenance_plans cascade;
drop table if exists resident_requests cascade;
drop table if exists spare_parts       cascade;
