-- 001_enable_rls.sql
-- Enable PostgreSQL row-level security for tenant-scoped tables.
-- Contract: every service transaction must set `app.current_tenant_id` via
-- `select set_config('app.current_tenant_id', <uuid>, true)` before issuing queries.
-- `true` scopes the setting to the transaction so it never leaks across requests.
-- Missing/invalid setting -> current_setting(...,true) returns NULL -> default-deny.
--
-- Note: Prisma maps tables to snake_case (via @@map) but columns keep their
-- camelCase model names, so SQL must quote them (e.g. "tenantId").
--
-- Role model: policies apply to every non-owner role. The table owner bypasses
-- RLS unless we enable FORCE; for dev we keep FORCE off so that the seed (run
-- by the same owner role as the API) can write without juggling contexts.
-- For production set up split roles: a migrator/owner without runtime access
-- and an app role that inherits RLS. Then add `alter table ... force row level
-- security` and revoke bypass from the app role.

create or replace function app_current_tenant_id() returns text
language sql
stable
as $$
  select current_setting('app.current_tenant_id', true);
$$;

do $$
declare
  t text;
  tables text[] := array[
    'organizations',
    'memberships',
    'organization_memberships',
    'buildings',
    'assets',
    'obligation_templates',
    'building_obligations',
    'ppm_templates',
    'ppm_plan_items',
    'task_instances',
    'budgets',
    'invoices',
    'approval_requests',
    'documents',
    'audit_entries'
  ];
  direct_tables text[] := array[
    'organizations',
    'memberships',
    'buildings',
    'assets',
    'obligation_templates',
    'building_obligations',
    'ppm_templates',
    'ppm_plan_items',
    'task_instances',
    'budgets',
    'invoices',
    'approval_requests',
    'documents',
    'audit_entries'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_tenant_isolation on %I', t, t);
  end loop;

  foreach t in array direct_tables loop
    execute format(
      'create policy %I_tenant_isolation on %I using ("tenantId" = app_current_tenant_id()) with check ("tenantId" = app_current_tenant_id())',
      t, t
    );
  end loop;
end $$;

-- organization_memberships has no tenantId column; scope via parent organization.
drop policy if exists organization_memberships_tenant_isolation on organization_memberships;
create policy organization_memberships_tenant_isolation on organization_memberships
  using (
    exists (
      select 1 from organizations o
      where o.id = organization_memberships."organizationId"
        and o."tenantId" = app_current_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from organizations o
      where o.id = organization_memberships."organizationId"
        and o."tenantId" = app_current_tenant_id()
    )
  );

-- budget_lines has no direct tenantId; scope via parent budget.
alter table budget_lines enable row level security;
drop policy if exists budget_lines_tenant_isolation on budget_lines;
create policy budget_lines_tenant_isolation on budget_lines
  using (
    exists (
      select 1 from budgets b
      where b.id = budget_lines."budgetId"
        and b."tenantId" = app_current_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from budgets b
      where b.id = budget_lines."budgetId"
        and b."tenantId" = app_current_tenant_id()
    )
  );

-- approval_steps has no direct tenantId; scope via parent approval_request.
alter table approval_steps enable row level security;
drop policy if exists approval_steps_tenant_isolation on approval_steps;
create policy approval_steps_tenant_isolation on approval_steps
  using (
    exists (
      select 1 from approval_requests r
      where r.id = approval_steps."requestId"
        and r."tenantId" = app_current_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from approval_requests r
      where r.id = approval_steps."requestId"
        and r."tenantId" = app_current_tenant_id()
    )
  );

-- seed_runs and tenants are administrative / root; RLS intentionally not applied.
