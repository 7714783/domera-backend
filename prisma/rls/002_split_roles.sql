-- 002_split_roles.sql
-- Split the single-role setup into:
--   domera_migrator  — owner of schema/tables, BYPASSRLS (for migrations + seeds)
--   domera_app       — runtime role, NOBYPASSRLS (subject to FORCE RLS)
--
-- Run as the database superuser. The password for domera_migrator must be set
-- through ALTER ROLE at apply-time (or via CREATE ROLE inside a do-block with
-- current_setting).
--
-- The script is idempotent; it can be re-applied safely.

do $$
declare
  migrator_pw text := coalesce(current_setting('app.migrator_password', true), 'domera_migrator');
  app_pw      text := coalesce(current_setting('app.app_password', true), 'domera_app');
begin
  if not exists (select 1 from pg_roles where rolname = 'domera_migrator') then
    execute format('create role domera_migrator with login bypassrls password %L', migrator_pw);
  else
    execute format('alter role domera_migrator with bypassrls');
    execute format('alter role domera_migrator with password %L', migrator_pw);
  end if;

  if not exists (select 1 from pg_roles where rolname = 'domera_app') then
    execute format('create role domera_app with login nobypassrls password %L', app_pw);
  else
    execute format('alter role domera_app with nobypassrls');
    execute format('alter role domera_app with password %L', app_pw);
  end if;
end $$;

-- Transfer ownership of every object in the public schema to the migrator.
do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r','p','v','m','S') -- table, partitioned, view, matview, sequence
  loop
    execute format('alter %s public.%I owner to domera_migrator',
      case r.relkind when 'S' then 'sequence' when 'v' then 'view' when 'm' then 'materialized view' else 'table' end,
      r.relname);
  end loop;
end $$;

grant usage on schema public to domera_app;

-- Current objects: allow DML + sequence usage to runtime role.
grant select, insert, update, delete on all tables in schema public to domera_app;
grant usage, select on all sequences in schema public to domera_app;

-- Future objects (created by migrator): same grants automatically.
alter default privileges for role domera_migrator in schema public
  grant select, insert, update, delete on tables to domera_app;
alter default privileges for role domera_migrator in schema public
  grant usage, select on sequences to domera_app;

-- Revoke any legacy public privileges.
revoke all on schema public from public;
grant usage on schema public to public;
