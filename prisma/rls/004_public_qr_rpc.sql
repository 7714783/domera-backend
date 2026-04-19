-- 004_public_qr_rpc.sql
-- Publicly-scannable QR codes must be resolvable from an unauthenticated
-- endpoint, but qr_locations is tenant-scoped with FORCE RLS. A knowledge of
-- the random qr UUID is treated as sufficient authorisation to derive the
-- (tenantId, buildingId) pair.
--
-- Solution: a SECURITY DEFINER function owned by the migrator role
-- (which has BYPASSRLS) that returns the minimal public fields the landing
-- page needs. Downstream service-request creation still runs through the
-- normal tenant-scoped path with set_config('app.current_tenant_id', ...).
--
-- Run after 001 + 002 + 003. Idempotent.

create or replace function public_resolve_qr(qr_id uuid)
returns table (
  "qrId"        uuid,
  "tenantId"    text,
  "buildingId"  text,
  "code"        text,
  "label"       text,
  "targetType"  text,
  "floorId"     text,
  "unitId"      text,
  "equipmentId" text,
  "spaceId"     text,
  "notes"       text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    q.id::uuid                 as "qrId",
    q."tenantId"               as "tenantId",
    q."buildingId"             as "buildingId",
    q.code                     as "code",
    q.label                    as "label",
    q."targetType"             as "targetType",
    q."floorId"                as "floorId",
    q."unitId"                 as "unitId",
    q."equipmentId"            as "equipmentId",
    q."spaceId"                as "spaceId",
    q.notes                    as "notes"
  from qr_locations q
  where q.id = qr_id::text;
$$;

alter function public_resolve_qr(uuid) owner to domera_migrator;
revoke all on function public_resolve_qr(uuid) from public;
grant execute on function public_resolve_qr(uuid) to domera_app;

-- Building + floor/unit lookups for display, same owner-bypass pattern.
create or replace function public_qr_building(bld_id text)
returns table (
  "id"    text,
  "slug"  text,
  "name"  text,
  "city"  text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select b.id, b.slug, b.name, b.city
  from buildings b
  where b.id = bld_id;
$$;

alter function public_qr_building(text) owner to domera_migrator;
revoke all on function public_qr_building(text) from public;
grant execute on function public_qr_building(text) to domera_app;
