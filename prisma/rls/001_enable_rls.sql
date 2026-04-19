-- 001_enable_rls.sql
-- Enable PostgreSQL row-level security for tenant-scoped tables.
-- Contract: every service transaction must set `app.current_tenant_id` via
-- `select set_config('app.current_tenant_id', <uuid>, true)` before issuing queries.
-- `true` scopes the setting to the transaction so it never leaks across requests.
-- Missing/invalid setting -> current_setting(...,true) returns NULL -> default-deny.
--
-- Prisma maps tables to snake_case (via @@map) but columns keep their
-- camelCase model names, so SQL must quote them (e.g. "tenantId").
--
-- Companion: 002_split_roles.sql (migrator/app split) and 003_force_rls.sql
-- (FORCE on owner). Apply in order 002 → 001 → 003.

create or replace function app_current_tenant_id() returns text
language sql
stable
as $$
  select current_setting('app.current_tenant_id', true);
$$;

do $$
declare
  t text;
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
    'ppm_execution_logs',
    'budgets',
    'invoices',
    'approval_requests',
    'documents',
    'audit_entries',
    'building_role_assignments',
    'building_mandates',
    'import_jobs',
    'engineering_recommendations',
    'projects',
    'work_orders',
    'takeover_cases',
    'parking_spots',
    'storage_units',
    'equipment_relations',
    'elevator_profiles',
    'document_links',
    'incidents',
    'service_requests',
    'quotes',
    'purchase_orders',
    'completion_records',
    'inventory_items',
    'stock_locations',
    'stock_movements',
    'qr_locations',
    'entrances',
    'floors',
    'units',
    'vendors',
    'contracts',
    'accounts',
    'maintenance_plans',
    'resident_requests',
    'notifications',
    'building_floors',
    'building_units',
    'building_vertical_transport',
    'building_systems',
    'building_occupant_companies',
    'building_unit_occupancies',
    'building_contracts',
    'compliance_profiles',
    'building_compliance_profiles',
    'sensor_points',
    'alarm_sources',
    'vendor_invoices',
    'emergency_overrides',
    'calendar_blackouts',
    'condition_triggers',
    'condition_events',
    'project_stages',
    'project_budget_lines',
    'change_orders',
    'acceptance_packs',
    'tenant_representatives',
    'approval_policies',
    'approval_delegations',
    'outbox_events',
    'webhook_subscriptions',
    'inbound_webhook_sources',
    'inbound_webhook_events',
    'personal_data_categories',
    'dsar_requests',
    'identity_providers',
    'oidc_login_states',
    'scim_tokens',
    'signed_urls',
    'subprocessor_registry',
    'dpa_templates',
    'cleaning_contractors',
    'cleaning_roles',
    'cleaning_staff',
    'cleaning_zones',
    'cleaning_qr_points',
    'cleaning_requests',
    'cleaning_request_comments',
    'cleaning_request_attachments',
    'cleaning_request_history'
  ];
begin
  foreach t in array direct_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_tenant_isolation on %I', t, t);
    execute format(
      'create policy %I_tenant_isolation on %I using ("tenantId" = app_current_tenant_id()) with check ("tenantId" = app_current_tenant_id())',
      t, t
    );
  end loop;
end $$;

-- organization_memberships has no tenantId column; scope via parent organization.
alter table organization_memberships enable row level security;
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

-- budget_lines: scope via parent budget.
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

-- approval_steps: scope via parent approval_request.
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

-- import_job_rows: scope via parent import_job.
alter table import_job_rows enable row level security;
drop policy if exists import_job_rows_tenant_isolation on import_job_rows;
create policy import_job_rows_tenant_isolation on import_job_rows
  using (
    exists (
      select 1 from import_jobs j
      where j.id = import_job_rows."importJobId"
        and j."tenantId" = app_current_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from import_jobs j
      where j.id = import_job_rows."importJobId"
        and j."tenantId" = app_current_tenant_id()
    )
  );

-- obligation_bases: scope via parent obligation_template.
alter table obligation_bases enable row level security;
drop policy if exists obligation_bases_tenant_isolation on obligation_bases;
create policy obligation_bases_tenant_isolation on obligation_bases
  using (
    exists (
      select 1 from obligation_templates o
      where o.id = obligation_bases."obligationTemplateId"
        and o."tenantId" = app_current_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from obligation_templates o
      where o.id = obligation_bases."obligationTemplateId"
        and o."tenantId" = app_current_tenant_id()
    )
  );

-- applicability_rules: scope via parent obligation_template.
alter table applicability_rules enable row level security;
drop policy if exists applicability_rules_tenant_isolation on applicability_rules;
create policy applicability_rules_tenant_isolation on applicability_rules
  using (
    exists (
      select 1 from obligation_templates o
      where o.id = applicability_rules."obligationTemplateId"
        and o."tenantId" = app_current_tenant_id()
    )
  )
  with check (
    exists (
      select 1 from obligation_templates o
      where o.id = applicability_rules."obligationTemplateId"
        and o."tenantId" = app_current_tenant_id()
    )
  );

-- seed_runs has tenantId but is administrative; leave policy in place but
-- allow migrator-role access via BYPASSRLS.
alter table seed_runs enable row level security;
drop policy if exists seed_runs_tenant_isolation on seed_runs;
create policy seed_runs_tenant_isolation on seed_runs
  using ("tenantId" = app_current_tenant_id())
  with check ("tenantId" = app_current_tenant_id());

-- tenants, users, sessions, certifications, document_types, roles,
-- role_permissions, user_certifications, building_settings: left without
-- RLS. Some are global catalogs; others (users, sessions) are identity
-- primitives the auth layer must be able to read without a tenant context.
