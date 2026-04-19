-- 003_force_rls.sql
-- Force row-level security even for table owners. Combined with the split
-- roles (002) where migrator=BYPASSRLS and app=NOBYPASSRLS, this ensures
-- the runtime role is strictly subject to tenant policies from 001.
--
-- Run after 001 + 002. Idempotent.

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
    'obligation_bases',
    'applicability_rules',
    'building_obligations',
    'ppm_templates',
    'ppm_plan_items',
    'task_instances',
    'ppm_execution_logs',
    'budgets',
    'budget_lines',
    'invoices',
    'approval_requests',
    'approval_steps',
    'documents',
    'audit_entries',
    'building_role_assignments',
    'building_mandates',
    'import_jobs',
    'import_job_rows',
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
    'seed_runs'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
