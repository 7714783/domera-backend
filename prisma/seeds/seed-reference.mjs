import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROLES = [
  {
    key: 'workspace_owner',
    name: 'Workspace Owner',
    scope: 'workspace',
    maxDelegatableScope: 'workspace',
  },
  {
    key: 'workspace_admin',
    name: 'Workspace Admin',
    scope: 'workspace',
    maxDelegatableScope: 'organization',
  },
  {
    key: 'org_admin',
    name: 'Organization Admin',
    scope: 'organization',
    maxDelegatableScope: 'building',
  },
  {
    key: 'owner_representative',
    name: 'Owner Representative',
    scope: 'building',
    maxDelegatableScope: null,
  },
  {
    key: 'building_manager',
    name: 'Building Manager',
    scope: 'building',
    maxDelegatableScope: 'building',
  },
  {
    key: 'chief_engineer',
    name: 'Chief Engineer',
    scope: 'building',
    maxDelegatableScope: 'building',
  },
  {
    key: 'fire_safety_officer',
    name: 'Fire Safety Officer',
    scope: 'building',
    maxDelegatableScope: null,
  },
  { key: 'energy_officer', name: 'Energy Officer', scope: 'building', maxDelegatableScope: null },
  {
    key: 'finance_controller',
    name: 'Finance Controller',
    scope: 'organization',
    maxDelegatableScope: null,
  },
  {
    key: 'document_controller',
    name: 'Document Controller',
    scope: 'organization',
    maxDelegatableScope: null,
  },
  {
    key: 'project_manager',
    name: 'Project Manager',
    scope: 'project',
    maxDelegatableScope: 'project',
  },
  {
    key: 'maintenance_coordinator',
    name: 'Maintenance Coordinator',
    scope: 'building',
    maxDelegatableScope: null,
  },
  {
    key: 'technician',
    name: 'Maintenance Technician',
    scope: 'building',
    maxDelegatableScope: null,
  },
  { key: 'cleaner', name: 'Cleaning Lead', scope: 'building', maxDelegatableScope: null },
  { key: 'contractor', name: 'External Contractor', scope: 'building', maxDelegatableScope: null },
  { key: 'vendor_user', name: 'Vendor User', scope: 'building', maxDelegatableScope: null },
  {
    key: 'external_engineer',
    name: 'External Engineer',
    scope: 'building',
    maxDelegatableScope: null,
  },
  {
    key: 'auditor',
    name: 'Auditor / Insurance Inspector',
    scope: 'building',
    maxDelegatableScope: null,
  },
  { key: 'viewer', name: 'Viewer', scope: 'building', maxDelegatableScope: null },
];

const PERMISSIONS = {
  workspace_owner: [
    'workspace.manage',
    'org.manage',
    'user.manage',
    'role.assign',
    'audit.read',
    'import.commit',
    'takeover.signoff',
  ],
  workspace_admin: [
    'workspace.read',
    'org.manage',
    'user.manage',
    'role.assign',
    'audit.read',
    'import.preview',
    'import.commit',
  ],
  org_admin: [
    'org.read',
    'building.manage',
    'role.assign',
    'user.invite',
    'mandate.manage',
    'audit.read',
  ],
  owner_representative: [
    'building.read',
    'budget.read',
    'approval.approve_l2',
    'approval.approve_l3',
    'document.read',
    'audit.read',
    'takeover.signoff',
  ],
  building_manager: [
    'building.read',
    'asset.manage',
    'ppm.manage',
    'task.assign',
    'budget.request',
    'approval.approve_l1',
    'document.read',
    'role.assign_scoped',
    'takeover.signoff',
  ],
  chief_engineer: [
    'building.read',
    'asset.manage',
    'ppm.manage',
    'task.complete_review',
    'document.approve_technical',
    'recommendation.review',
    'takeover.signoff',
  ],
  fire_safety_officer: [
    'building.read',
    'task.complete',
    'document.upload_evidence',
    'document.approve_fire',
  ],
  energy_officer: [
    'building.read',
    'task.complete',
    'document.upload_evidence',
    'document.approve_energy',
  ],
  finance_controller: [
    'budget.manage',
    'invoice.manage',
    'approval.approve_finance',
    'document.read',
  ],
  document_controller: [
    'document.create',
    'document.review',
    'document.publish',
    'document.retention',
  ],
  project_manager: ['project.manage', 'budget.request', 'document.create', 'approval.request'],
  maintenance_coordinator: [
    'task.assign',
    'task.reschedule',
    'workorder.dispatch',
    'document.upload_evidence',
  ],
  technician: ['task.read_assigned', 'task.complete', 'document.upload_evidence'],
  cleaner: ['task.read_assigned', 'task.complete_soft_services'],
  contractor: [
    'workorder.read_assigned',
    'task.read_assigned',
    'task.complete_soft_services',
    'document.upload_certificate',
  ],
  vendor_user: [
    'workorder.read_assigned',
    'document.upload_certificate',
    'task.complete_vendor_scope',
  ],
  external_engineer: ['building.read', 'recommendation.create', 'document.create'],
  auditor: ['building.read', 'document.read', 'audit.read'],
  viewer: ['building.read', 'document.read'],
};

const CERTIFICATIONS = [
  {
    key: 'electrician_l3',
    name: 'Inspecting Electrician Class 3',
    issuingAuthority: 'Ministry of Energy (IL)',
    domain: 'electrical',
  },
  {
    key: 'electrician_hv',
    name: 'High-Voltage Licensed Electrician',
    issuingAuthority: 'Ministry of Energy (IL)',
    domain: 'electrical',
  },
  {
    key: 'accredited_lab',
    name: 'Accredited Laboratory',
    issuingAuthority: 'Israel Laboratory Accreditation Authority',
    domain: 'water,electrical,fire',
  },
  {
    key: 'licensed_lift_inspector',
    name: 'Certified Lift Inspector',
    issuingAuthority: 'Ministry of Labor (IL)',
    domain: 'vertical_transport',
  },
  {
    key: 'licensed_escalator_inspector',
    name: 'Certified Escalator Inspector',
    issuingAuthority: 'Ministry of Labor (IL)',
    domain: 'vertical_transport',
  },
  {
    key: 'certified_disinfector',
    name: 'Certified Water Systems Disinfector',
    issuingAuthority: 'Ministry of Health (IL)',
    domain: 'water',
  },
  {
    key: 'fire_safety_inspector',
    name: 'Fire & Rescue Services Inspector',
    issuingAuthority: 'Fire & Rescue Services (IL)',
    domain: 'fire',
  },
  {
    key: 'licensed_energy_surveyor',
    name: 'Licensed Energy Surveyor',
    issuingAuthority: 'Ministry of Energy (IL)',
    domain: 'energy',
  },
  {
    key: 'registered_mechanical_engineer',
    name: 'Registered Mechanical Engineer',
    issuingAuthority: 'Engineers Registrar (IL)',
    domain: 'engineering',
  },
  {
    key: 'registered_civil_engineer',
    name: 'Registered Civil Engineer',
    issuingAuthority: 'Engineers Registrar (IL)',
    domain: 'engineering',
  },
  {
    key: 'authorized_lpg_installer',
    name: 'Authorized LPG Installer',
    issuingAuthority: 'Ministry of Energy (IL)',
    domain: 'gas',
  },
  {
    key: 'pressure_vessel_inspector',
    name: 'Certified Pressure Vessel Inspector',
    issuingAuthority: 'Ministry of Labor (IL)',
    domain: 'lifting_pressure',
  },
  {
    key: 'lifting_gear_inspector',
    name: 'Certified Lifting Gear Inspector',
    issuingAuthority: 'Ministry of Labor (IL)',
    domain: 'lifting_pressure',
  },
  {
    key: 'lightning_protection_inspector',
    name: 'Lightning Protection Systems Inspector',
    issuingAuthority: 'Ministry of Labor (IL)',
    domain: 'electrical',
  },
  {
    key: 'thermography_surveyor',
    name: 'Certified Thermography Surveyor',
    issuingAuthority: 'Standards Institution (IL)',
    domain: 'electrical',
  },
];

const DOCUMENT_TYPES = [
  {
    key: 'fs_form_1',
    name: 'Fire Services Form 1',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_2',
    name: 'Fire Services Form 2',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_3',
    name: 'Fire Services Form 3',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_4',
    name: 'Fire Services Form 4',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_5',
    name: 'Fire Services Form 5',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_6',
    name: 'Fire Services Form 6',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_8',
    name: 'Fire Services Form 8',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_9a',
    name: 'Fire Services Form 9A',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_9b',
    name: 'Fire Services Form 9B',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_10',
    name: 'Fire Services Form 10',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_11',
    name: 'Fire Services Form 11',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_13',
    name: 'Fire Services Form 13',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'fs_form_16',
    name: 'Fire Services Form 16',
    issuingAuthority: 'Fire & Rescue Services (IL)',
  },
  {
    key: 'ti_158_4_d4',
    name: 'SI 158-4 Form D4 (LPG Installation)',
    issuingAuthority: 'Standards Institution (IL)',
  },
  {
    key: 'ti_158_4_d5',
    name: 'SI 158-4 Form D5 (LPG Periodic)',
    issuingAuthority: 'Standards Institution (IL)',
  },
  {
    key: 'thermography_report',
    name: 'Thermography Report + Calibration Certificate',
    issuingAuthority: 'Accredited Lab',
  },
  {
    key: 'earthing_certificate',
    name: 'Earthing / Foundation Electrode Certificate',
    issuingAuthority: 'Inspecting Electrician',
  },
  {
    key: 'lab_analysis',
    name: 'Accredited Laboratory Analysis Report',
    issuingAuthority: 'Accredited Lab',
  },
  {
    key: 'inspector_report',
    name: 'Licensed Inspector Report (Tasrih)',
    issuingAuthority: 'Licensed Inspector',
  },
  {
    key: 'service_contract',
    name: 'Service / Maintenance Contract',
    issuingAuthority: 'Contracting Parties',
  },
  {
    key: 'engineer_approval',
    name: 'Registered Engineer Approval',
    issuingAuthority: 'Engineers Registrar (IL)',
  },
  {
    key: 'emergency_plan_update',
    name: 'Emergency Procedure Update Declaration',
    issuingAuthority: 'Building Operator',
  },
  {
    key: 'energy_survey_report',
    name: 'Energy Survey / Consumption Report',
    issuingAuthority: 'Ministry of Energy (IL)',
  },
  { key: 'handover_checklist', name: 'Building Handover Checklist', issuingAuthority: 'Operator' },
  { key: 'internal_form', name: 'Internal Maintenance Form', issuingAuthority: 'Operator' },
];

async function run() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      create: role,
      update: { name: role.name, scope: role.scope, maxDelegatableScope: role.maxDelegatableScope },
    });
  }

  for (const [roleKey, perms] of Object.entries(PERMISSIONS)) {
    for (const permission of perms) {
      await prisma.rolePermission.upsert({
        where: { roleKey_permission: { roleKey, permission } },
        create: { roleKey, permission },
        update: {},
      });
    }
  }

  for (const cert of CERTIFICATIONS) {
    await prisma.certification.upsert({
      where: { key: cert.key },
      create: cert,
      update: { name: cert.name, issuingAuthority: cert.issuingAuthority, domain: cert.domain },
    });
  }

  for (const dt of DOCUMENT_TYPES) {
    await prisma.documentType.upsert({
      where: { key: dt.key },
      create: dt,
      update: { name: dt.name, issuingAuthority: dt.issuingAuthority },
    });
  }

  const roleCount = await prisma.role.count();
  const permCount = await prisma.rolePermission.count();
  const certCount = await prisma.certification.count();
  const dtCount = await prisma.documentType.count();
  console.log(
    `[reference] roles=${roleCount} permissions=${permCount} certifications=${certCount} document_types=${dtCount}`,
  );
}

run()
  .catch((err) => {
    console.error('[reference] failed', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
