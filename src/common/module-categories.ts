// INIT-013 — canonical module-category list.
//
// Every backend module under apps/api/src/modules/<name>/ MUST declare
// its category in a sibling `module.meta.ts` exporting MODULE_CATEGORY.
// The CI gate `module-category-coverage` enforces this — modules
// without a category fail the build.
//
// Categories are the broad business domains used by the role-builder UI
// to group permissions. A custom role created by a workspace_owner picks
// N categories first, then N permissions within them.
//
// New categories MUST be added here AND in the role-builder UI mapping.

export const MODULE_CATEGORIES = [
  'finance',       // budgets, invoices, financial approvals, capex
  'tech_support',  // ppm, assets, systems, incidents, tasks
  'legal',         // documents, retention, legal_hold, gdpr, dsar
  'cleaning',      // cleaning, rounds, waypoints
  'security',      // security, public_qr (intake), security incidents
  'compliance',    // compliance profiles, certifications, audit, ropa
  'operations',    // buildings, floors, units, locations, transport
  'people',        // team, roles, role_assignments, iam, auth
  'enterprise',    // projects, leases, takeover, vendor_invoice, contractors
  'mobile',        // mobile lifecycle, devices
  'platform',      // events, health, metrics, webhooks, scim, sso, mfa, seed-runtime
] as const;

export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

export function isModuleCategory(s: string): s is ModuleCategory {
  return (MODULE_CATEGORIES as readonly string[]).includes(s);
}
