-- Enable row-level security on every tenant-scoped table. Each gets:
--   ENABLE ROW LEVEL SECURITY (filter reads/writes by app.tenant_id GUC)
--   FORCE ROW LEVEL SECURITY (no superuser bypass for app role)
--   tenant_isolation policy (USING + WITH CHECK on tenantId = GUC)
-- Idempotent via IF NOT EXISTS / DROP POLICY IF EXISTS.
-- 2 tables already have RLS enabled (building_unit_groups,
-- occupant_company_settings) — re-applying the policy is safe.

ALTER TABLE "acceptance_packs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "acceptance_packs" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "acceptance_packs";
CREATE POLICY tenant_isolation ON "acceptance_packs" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "accounts";
CREATE POLICY tenant_isolation ON "accounts" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "alarm_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alarm_sources" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "alarm_sources";
CREATE POLICY tenant_isolation ON "alarm_sources" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "approval_delegations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_delegations" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "approval_delegations";
CREATE POLICY tenant_isolation ON "approval_delegations" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "approval_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_policies" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "approval_policies";
CREATE POLICY tenant_isolation ON "approval_policies" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_requests" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "approval_requests";
CREATE POLICY tenant_isolation ON "approval_requests" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "asset_custom_attributes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_custom_attributes" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "asset_custom_attributes";
CREATE POLICY tenant_isolation ON "asset_custom_attributes" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "asset_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_documents" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "asset_documents";
CREATE POLICY tenant_isolation ON "asset_documents" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "asset_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_media" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "asset_media";
CREATE POLICY tenant_isolation ON "asset_media" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "asset_spare_parts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_spare_parts" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "asset_spare_parts";
CREATE POLICY tenant_isolation ON "asset_spare_parts" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "asset_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_types" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "asset_types";
CREATE POLICY tenant_isolation ON "asset_types" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assets";
CREATE POLICY tenant_isolation ON "assets" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "audit_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_entries" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_entries";
CREATE POLICY tenant_isolation ON "audit_entries" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budgets" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "budgets";
CREATE POLICY tenant_isolation ON "budgets" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_compliance_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_compliance_profiles" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_compliance_profiles";
CREATE POLICY tenant_isolation ON "building_compliance_profiles" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_contracts" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_contracts";
CREATE POLICY tenant_isolation ON "building_contracts" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_floors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_floors" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_floors";
CREATE POLICY tenant_isolation ON "building_floors" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_locations" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_locations";
CREATE POLICY tenant_isolation ON "building_locations" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_mandates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_mandates" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_mandates";
CREATE POLICY tenant_isolation ON "building_mandates" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_obligations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_obligations" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_obligations";
CREATE POLICY tenant_isolation ON "building_obligations" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_occupant_companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_occupant_companies" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_occupant_companies";
CREATE POLICY tenant_isolation ON "building_occupant_companies" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_role_assignments" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_role_assignments";
CREATE POLICY tenant_isolation ON "building_role_assignments" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_systems" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_systems" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_systems";
CREATE POLICY tenant_isolation ON "building_systems" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_unit_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_unit_groups" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_unit_groups";
CREATE POLICY tenant_isolation ON "building_unit_groups" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_unit_occupancies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_unit_occupancies" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_unit_occupancies";
CREATE POLICY tenant_isolation ON "building_unit_occupancies" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_units" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_units";
CREATE POLICY tenant_isolation ON "building_units" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "building_vertical_transport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "building_vertical_transport" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "building_vertical_transport";
CREATE POLICY tenant_isolation ON "building_vertical_transport" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "buildings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "buildings" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "buildings";
CREATE POLICY tenant_isolation ON "buildings" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "calendar_blackouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_blackouts" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "calendar_blackouts";
CREATE POLICY tenant_isolation ON "calendar_blackouts" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "change_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_orders" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "change_orders";
CREATE POLICY tenant_isolation ON "change_orders" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "cleaning_contractors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cleaning_contractors" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cleaning_contractors";
CREATE POLICY tenant_isolation ON "cleaning_contractors" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "cleaning_qr_points" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cleaning_qr_points" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cleaning_qr_points";
CREATE POLICY tenant_isolation ON "cleaning_qr_points" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "cleaning_request_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cleaning_request_attachments" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cleaning_request_attachments";
CREATE POLICY tenant_isolation ON "cleaning_request_attachments" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "cleaning_request_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cleaning_request_comments" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cleaning_request_comments";
CREATE POLICY tenant_isolation ON "cleaning_request_comments" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "cleaning_request_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cleaning_request_history" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cleaning_request_history";
CREATE POLICY tenant_isolation ON "cleaning_request_history" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "cleaning_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cleaning_requests" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cleaning_requests";
CREATE POLICY tenant_isolation ON "cleaning_requests" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "cleaning_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cleaning_roles" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cleaning_roles";
CREATE POLICY tenant_isolation ON "cleaning_roles" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "cleaning_staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cleaning_staff" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cleaning_staff";
CREATE POLICY tenant_isolation ON "cleaning_staff" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "cleaning_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cleaning_zones" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cleaning_zones";
CREATE POLICY tenant_isolation ON "cleaning_zones" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "completion_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "completion_records" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "completion_records";
CREATE POLICY tenant_isolation ON "completion_records" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "compliance_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_profiles" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "compliance_profiles";
CREATE POLICY tenant_isolation ON "compliance_profiles" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "condition_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "condition_events" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "condition_events";
CREATE POLICY tenant_isolation ON "condition_events" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "condition_triggers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "condition_triggers" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "condition_triggers";
CREATE POLICY tenant_isolation ON "condition_triggers" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "contracts";
CREATE POLICY tenant_isolation ON "contracts" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "document_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_links" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "document_links";
CREATE POLICY tenant_isolation ON "document_links" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_templates" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "document_templates";
CREATE POLICY tenant_isolation ON "document_templates" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "documents";
CREATE POLICY tenant_isolation ON "documents" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "dpa_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dpa_templates" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dpa_templates";
CREATE POLICY tenant_isolation ON "dpa_templates" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "dsar_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dsar_requests" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dsar_requests";
CREATE POLICY tenant_isolation ON "dsar_requests" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "elevator_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "elevator_profiles" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "elevator_profiles";
CREATE POLICY tenant_isolation ON "elevator_profiles" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "emergency_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "emergency_overrides" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "emergency_overrides";
CREATE POLICY tenant_isolation ON "emergency_overrides" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "engineering_recommendations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engineering_recommendations" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "engineering_recommendations";
CREATE POLICY tenant_isolation ON "engineering_recommendations" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "entrances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entrances" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "entrances";
CREATE POLICY tenant_isolation ON "entrances" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "equipment_relations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_relations" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "equipment_relations";
CREATE POLICY tenant_isolation ON "equipment_relations" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "floors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "floors" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "floors";
CREATE POLICY tenant_isolation ON "floors" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "identity_providers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_providers" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "identity_providers";
CREATE POLICY tenant_isolation ON "identity_providers" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "import_jobs";
CREATE POLICY tenant_isolation ON "import_jobs" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "inbound_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbound_webhook_events" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "inbound_webhook_events";
CREATE POLICY tenant_isolation ON "inbound_webhook_events" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "inbound_webhook_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbound_webhook_sources" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "inbound_webhook_sources";
CREATE POLICY tenant_isolation ON "inbound_webhook_sources" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incidents" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "incidents";
CREATE POLICY tenant_isolation ON "incidents" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_items" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "inventory_items";
CREATE POLICY tenant_isolation ON "inventory_items" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "invoices";
CREATE POLICY tenant_isolation ON "invoices" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "lease_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_allocations" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_allocations";
CREATE POLICY tenant_isolation ON "lease_allocations" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "maintenance_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_plans" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "maintenance_plans";
CREATE POLICY tenant_isolation ON "maintenance_plans" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "memberships";
CREATE POLICY tenant_isolation ON "memberships" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notifications";
CREATE POLICY tenant_isolation ON "notifications" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "obligation_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "obligation_templates" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "obligation_templates";
CREATE POLICY tenant_isolation ON "obligation_templates" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "occupant_company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "occupant_company_settings" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "occupant_company_settings";
CREATE POLICY tenant_isolation ON "occupant_company_settings" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "oidc_login_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oidc_login_states" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "oidc_login_states";
CREATE POLICY tenant_isolation ON "oidc_login_states" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "organizations";
CREATE POLICY tenant_isolation ON "organizations" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outbox_events";
CREATE POLICY tenant_isolation ON "outbox_events" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "parking_spots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parking_spots" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "parking_spots";
CREATE POLICY tenant_isolation ON "parking_spots" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "personal_data_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_data_categories" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "personal_data_categories";
CREATE POLICY tenant_isolation ON "personal_data_categories" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "ppm_execution_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ppm_execution_logs" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ppm_execution_logs";
CREATE POLICY tenant_isolation ON "ppm_execution_logs" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "ppm_plan_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ppm_plan_items" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ppm_plan_items";
CREATE POLICY tenant_isolation ON "ppm_plan_items" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "ppm_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ppm_templates" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ppm_templates";
CREATE POLICY tenant_isolation ON "ppm_templates" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "project_budget_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_budget_lines" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "project_budget_lines";
CREATE POLICY tenant_isolation ON "project_budget_lines" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "project_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_stages" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "project_stages";
CREATE POLICY tenant_isolation ON "project_stages" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "projects";
CREATE POLICY tenant_isolation ON "projects" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "purchase_orders";
CREATE POLICY tenant_isolation ON "purchase_orders" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "qr_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qr_locations" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "qr_locations";
CREATE POLICY tenant_isolation ON "qr_locations" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "quotes";
CREATE POLICY tenant_isolation ON "quotes" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "resident_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resident_requests" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "resident_requests";
CREATE POLICY tenant_isolation ON "resident_requests" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "round_instance_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "round_instance_answers" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "round_instance_answers";
CREATE POLICY tenant_isolation ON "round_instance_answers" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "round_instances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "round_instances" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "round_instances";
CREATE POLICY tenant_isolation ON "round_instances" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "round_waypoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "round_waypoints" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "round_waypoints";
CREATE POLICY tenant_isolation ON "round_waypoints" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "rounds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rounds" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "rounds";
CREATE POLICY tenant_isolation ON "rounds" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "scim_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scim_tokens" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "scim_tokens";
CREATE POLICY tenant_isolation ON "scim_tokens" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "seed_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seed_runs" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "seed_runs";
CREATE POLICY tenant_isolation ON "seed_runs" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "sensor_points" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sensor_points" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sensor_points";
CREATE POLICY tenant_isolation ON "sensor_points" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "service_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_requests" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "service_requests";
CREATE POLICY tenant_isolation ON "service_requests" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "signed_urls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signed_urls" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "signed_urls";
CREATE POLICY tenant_isolation ON "signed_urls" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "spare_parts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spare_parts" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "spare_parts";
CREATE POLICY tenant_isolation ON "spare_parts" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "stock_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_locations" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "stock_locations";
CREATE POLICY tenant_isolation ON "stock_locations" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "stock_movements";
CREATE POLICY tenant_isolation ON "stock_movements" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "storage_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "storage_units" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "storage_units";
CREATE POLICY tenant_isolation ON "storage_units" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "subprocessor_registry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subprocessor_registry" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "subprocessor_registry";
CREATE POLICY tenant_isolation ON "subprocessor_registry" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "takeover_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takeover_cases" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "takeover_cases";
CREATE POLICY tenant_isolation ON "takeover_cases" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "task_instances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_instances" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "task_instances";
CREATE POLICY tenant_isolation ON "task_instances" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "tenant_representatives" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_representatives" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_representatives";
CREATE POLICY tenant_isolation ON "tenant_representatives" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "units";
CREATE POLICY tenant_isolation ON "units" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "vendor_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendor_invoices" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "vendor_invoices";
CREATE POLICY tenant_isolation ON "vendor_invoices" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendors" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "vendors";
CREATE POLICY tenant_isolation ON "vendors" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "webhook_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_subscriptions" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "webhook_subscriptions";
CREATE POLICY tenant_isolation ON "webhook_subscriptions" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_orders" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "work_orders";
CREATE POLICY tenant_isolation ON "work_orders" USING ("tenantId" = current_setting('app.tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

