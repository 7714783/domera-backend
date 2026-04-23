// Seed the PPM core for the first real building (Migdal Menivim Kfar Saba).
// - Adds AS-EITAN as the management_company organization and a vendor for
//   chiller service ("Chiller Service Co.") with a live contract.
// - Creates 15 PPM programs grouped by execution mode:
//     in_house         → AS-EITAN performs (no quote needed)
//     contracted       → existing vendor under contract (no per-event quote)
//     ad_hoc_approved  → quote → approval → order → evidence flow
// - Each program spawns one PpmPlanItem with nextDueAt derived from
//   obligation recurrence and a realistic lastPerformedAt.
//
// Idempotent: skips insertion if PpmTemplate with the computed seedKey exists.

import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

const BUILDING_SLUG = process.env.FIRST_BUILDING_SLUG || 'menivim-kfar-saba';

const RRULE_MONTHS = (rule, fallback) => {
  if (/FREQ=DAILY/.test(rule)) return 0;
  if (/FREQ=WEEKLY;INTERVAL=2/.test(rule)) return 0.5;
  if (/FREQ=MONTHLY;INTERVAL=1/.test(rule)) return 1;
  if (/FREQ=MONTHLY;INTERVAL=3/.test(rule)) return 3;
  if (/FREQ=MONTHLY;INTERVAL=6/.test(rule)) return 6;
  if (/FREQ=YEARLY;INTERVAL=1/.test(rule)) return 12;
  if (/FREQ=YEARLY;INTERVAL=5/.test(rule)) return 60;
  return fallback || 12;
};

function addMonths(from, months) {
  const d = new Date(from);
  if (months >= 1) d.setMonth(d.getMonth() + Math.round(months));
  else d.setDate(d.getDate() + Math.round(months * 30));
  return d;
}

async function ensureOrg(tenantId, data) {
  const existing = await prisma.organization.findFirst({ where: { tenantId, slug: data.slug } });
  if (existing) return existing;
  return prisma.organization.create({
    data: { tenantId, status: 'active', createdBy: 'seed:ppm', ...data },
  });
}

async function ensureMandate(tenantId, buildingId, organizationId, mandateType) {
  const existing = await prisma.buildingMandate.findFirst({ where: { tenantId, buildingId, organizationId, mandateType } });
  if (existing) return existing;
  return prisma.buildingMandate.create({
    data: { tenantId, buildingId, organizationId, mandateType, effectiveFrom: new Date() },
  });
}

async function ensureContract(tenantId, buildingId, vendorOrgId, label, months = 6) {
  // Use existing service_contracts table if present; fallback: record in notes only.
  // We reuse the BuildingContract model (lease|service) to represent the chiller contract.
  const existing = await prisma.buildingContract.findFirst({
    where: { tenantId, buildingId, contractType: 'service', notes: label },
  });
  if (existing) return existing;
  // BuildingContract is keyed on an occupant company (tenant of the building).
  // For service contracts with an external vendor we reuse occupant_company table as
  // the vendor counterparty; cheapest minimal path for the MVP.
  const vendorCompany = await prisma.buildingOccupantCompany.upsert({
    where: { id: `vendor-company-${vendorOrgId}` },
    create: {
      id: `vendor-company-${vendorOrgId}`,
      tenantId, buildingId,
      companyName: label,
      companyType: 'vendor',
    },
    update: {},
  }).catch(async () => {
    return prisma.buildingOccupantCompany.create({
      data: { tenantId, buildingId, companyName: label, companyType: 'vendor' },
    });
  });
  return prisma.buildingContract.create({
    data: {
      tenantId, buildingId,
      occupantCompanyId: vendorCompany.id,
      contractType: 'service',
      contractNumber: `SVC-${label.replace(/\s+/g, '-').toUpperCase()}`,
      startDate: new Date(Date.now() - months * 30 * 86400000),
      status: 'active',
      notes: label,
    },
  });
}

async function ensurePpmProgram(tenantId, buildingId, userId, {
  seedKey, obligation, name, description, scope, executionMode, performerOrgId, contractId, assignedRole, frequencyMonths, domain, evidenceDocTypeKey,
  lastDoneDaysAgo,
}) {
  const existing = await prisma.ppmTemplate.findUnique({ where: { seedKey } });
  if (existing) return existing;

  const template = await prisma.ppmTemplate.create({
    data: {
      tenantId, buildingId,
      name,
      description: description || null,
      domain: domain || obligation.domain || null,
      scope, executionMode,
      performerOrgId: performerOrgId || null,
      contractId: contractId || null,
      requiresApprovalBeforeOrder: executionMode === 'ad_hoc_approved',
      frequencyMonths: frequencyMonths || null,
      evidenceDocTypeKey: evidenceDocTypeKey || obligation.requiredDocumentTypeKey || null,
      assignedRole: assignedRole || null,
      seedKey,
      createdBy: `user:${userId}`,
    },
  });

  const months = RRULE_MONTHS(obligation.recurrenceRule, frequencyMonths);
  const lastPerformedAt = lastDoneDaysAgo != null ? new Date(Date.now() - lastDoneDaysAgo * 86400000) : null;
  const nextDueAt = lastPerformedAt
    ? addMonths(lastPerformedAt, Math.max(months, 0.5))
    : addMonths(new Date(), Math.max(months, 0.5));

  await prisma.ppmPlanItem.create({
    data: {
      tenantId, buildingId,
      templateId: template.id,
      obligationTemplateId: obligation.id,
      assignedRole: assignedRole || 'maintenance_coordinator',
      recurrenceRule: obligation.recurrenceRule,
      nextDueAt,
      lastPerformedAt,
      scope, executionMode,
      performerOrgId: performerOrgId || null,
      contractId: contractId || null,
      seedKey: `${seedKey}:plan`,
      createdBy: `user:${userId}`,
    },
  });
  return template;
}

async function run() {
  const building = await prisma.building.findFirst({ where: { slug: BUILDING_SLUG } });
  if (!building) { console.error('building not found:', BUILDING_SLUG); process.exit(1); }
  const tenantId = building.tenantId;
  const user = await prisma.user.findFirst({ where: { username: 'Menivim' } });
  if (!user) { console.error('superadmin Menivim missing'); process.exit(1); }

  const owner = await prisma.organization.findFirst({ where: { tenantId, type: 'owner' } });

  const asEitan = await ensureOrg(tenantId, {
    name: 'AS-EITAN Facility Management',
    slug: 'as-eitan',
    type: 'management_company',
  });
  await ensureMandate(tenantId, building.id, asEitan.id, 'management_company');

  const chillerVendor = await ensureOrg(tenantId, {
    name: 'Chiller Service Co.',
    slug: 'chiller-service-co',
    type: 'vendor',
  });
  const fireVendor = await ensureOrg(tenantId, {
    name: 'Fire & Rescue Maintenance Ltd.',
    slug: 'fire-rescue-maintenance',
    type: 'vendor',
  });
  const liftVendor = await ensureOrg(tenantId, {
    name: 'Lift Services Israel',
    slug: 'lift-services-israel',
    type: 'vendor',
  });
  const accLab = await ensureOrg(tenantId, {
    name: 'Accredited Water Lab',
    slug: 'accredited-water-lab',
    type: 'vendor',
  });

  const chillerContract = await ensureContract(tenantId, building.id, chillerVendor.id, 'Chillers — biannual service');
  const fireContract = await ensureContract(tenantId, building.id, fireVendor.id, 'Fire alarm & detection — quarterly');
  const liftContract = await ensureContract(tenantId, building.id, liftVendor.id, 'Lifts — monthly preventive');

  const obligations = await prisma.obligationTemplate.findMany({ where: { tenantId } });
  const find = (namePart) => obligations.find((o) => new RegExp(namePart, 'i').test(o.name));

  const specs = [
    // Contracted (ready vendor, no per-event quote)
    {
      match: 'fire alarm|מערכת גילוי אש|גילוי אש',
      seedKey: 'ppm:fire-alarm-quarterly',
      name: 'Fire alarm & detection — quarterly',
      description: 'Contracted PPM performed by Fire & Rescue Maintenance Ltd. every 3 months. Form 4.',
      scope: 'building_common', executionMode: 'contracted',
      performerOrgId: fireVendor.id, contractId: fireContract.id,
      assignedRole: 'fire_safety_officer', frequencyMonths: 3,
      domain: 'fire_life_safety',
      lastDoneDaysAgo: 40,
    },
    {
      match: 'lift|מעלית',
      seedKey: 'ppm:lifts-monthly',
      name: 'Lifts — monthly preventive',
      description: 'Contracted PPM by Lift Services Israel. Applies to all 9 cabins (6 passenger + 1 freight + 2 parking).',
      scope: 'building_common', executionMode: 'contracted',
      performerOrgId: liftVendor.id, contractId: liftContract.id,
      assignedRole: 'chief_engineer', frequencyMonths: 1,
      domain: 'vertical_transport',
      lastDoneDaysAgo: 10,
    },
    {
      match: 'chiller|צ.ילר',
      seedKey: 'ppm:chillers-biannual',
      name: 'Chillers — biannual full service',
      description: 'Contracted PPM by Chiller Service Co., twice a year for all 4 rooftop chillers.',
      scope: 'building_common', executionMode: 'contracted',
      performerOrgId: chillerVendor.id, contractId: chillerContract.id,
      assignedRole: 'chief_engineer', frequencyMonths: 6,
      domain: 'hvac',
      lastDoneDaysAgo: 60,
    },
    // In-house (AS-EITAN performs directly, no approval needed)
    {
      match: 'fire pump|משאבת כיבוי',
      seedKey: 'ppm:fire-pump-monthly',
      name: 'Fire pump — monthly run test',
      description: 'In-house run test performed by AS-EITAN chief engineer. Pump room on -5.',
      scope: 'building_common', executionMode: 'in_house',
      performerOrgId: asEitan.id, assignedRole: 'chief_engineer',
      frequencyMonths: 1, domain: 'fire_life_safety',
      lastDoneDaysAgo: 28,
    },
    {
      match: 'emergency light|תאורת חירום',
      seedKey: 'ppm:emergency-lighting-semiannual',
      name: 'Emergency lighting — semiannual test',
      description: 'In-house test by AS-EITAN.',
      scope: 'building_common', executionMode: 'in_house',
      performerOrgId: asEitan.id, assignedRole: 'chief_engineer',
      frequencyMonths: 6, domain: 'electrical',
      lastDoneDaysAgo: 120,
    },
    {
      match: 'cleaning|ניקיון',
      seedKey: 'ppm:common-area-cleaning-daily',
      name: 'Common area cleaning — daily',
      description: 'In-house cleaning of lobby, stairs, elevator cabins, common corridors.',
      scope: 'building_common', executionMode: 'in_house',
      performerOrgId: asEitan.id, assignedRole: 'cleaner',
      frequencyMonths: 0, domain: 'soft_services',
      lastDoneDaysAgo: 1,
    },
    {
      match: 'smoke fan|smoke|עשן',
      seedKey: 'ppm:smoke-fans-annual',
      name: 'Smoke extraction fans — annual functional test',
      description: 'In-house functional test on the rooftop fans (co-ordinated with fire vendor).',
      scope: 'building_common', executionMode: 'in_house',
      performerOrgId: asEitan.id, assignedRole: 'chief_engineer',
      frequencyMonths: 12, domain: 'fire_life_safety',
      lastDoneDaysAgo: 300,
    },
    {
      match: 'lightning|ברקים',
      seedKey: 'ppm:lightning-protection-annual',
      name: 'Lightning protection — annual inspection',
      description: 'Coordinated by AS-EITAN with certified inspector.',
      scope: 'building_common', executionMode: 'in_house',
      performerOrgId: asEitan.id, assignedRole: 'chief_engineer',
      frequencyMonths: 12, domain: 'electrical',
      lastDoneDaysAgo: 200,
    },
    // Ad-hoc (needs quote → approval → order → evidence)
    {
      match: 'generator|גנרטור',
      seedKey: 'ppm:generator-load-bank',
      name: 'Generator — load bank test (biannual)',
      description: 'Ad-hoc: request quote from service company, approve with owner rep, then order.',
      scope: 'building_common', executionMode: 'ad_hoc_approved',
      assignedRole: 'chief_engineer', frequencyMonths: 6, domain: 'electrical',
      lastDoneDaysAgo: 160,
    },
    {
      match: 'legionella|ליגיונלה',
      seedKey: 'ppm:legionella-quarterly',
      name: 'Legionella sampling — quarterly',
      description: 'Accredited lab sampling. Each event: quote → approval → order → lab report.',
      scope: 'building_common', executionMode: 'ad_hoc_approved',
      performerOrgId: accLab.id,
      assignedRole: 'chief_engineer', frequencyMonths: 3, domain: 'water_plumbing',
      lastDoneDaysAgo: 75,
    },
    {
      match: 'backflow|מז.ח',
      seedKey: 'ppm:backflow-annual',
      name: 'Backflow preventer — annual inspection',
      description: 'Ad-hoc certified inspector. Approval required.',
      scope: 'building_common', executionMode: 'ad_hoc_approved',
      assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'water_plumbing',
      lastDoneDaysAgo: 320,
    },
    {
      match: 'thermograph|טרמוגרפי',
      seedKey: 'ppm:thermography-annual',
      name: 'Electrical thermography — annual survey',
      description: 'Ad-hoc survey by certified thermography surveyor.',
      scope: 'building_common', executionMode: 'ad_hoc_approved',
      assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'electrical',
      lastDoneDaysAgo: 280,
    },
    {
      match: 'water tank|חיטוי|פנים מאגר',
      seedKey: 'ppm:water-tank-disinfection',
      name: 'Cold water tank — annual disinfection',
      description: 'Certified disinfector. Ad-hoc approval.',
      scope: 'building_common', executionMode: 'ad_hoc_approved',
      assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'water_plumbing',
      lastDoneDaysAgo: 200,
    },
    {
      match: 'fire doors|דלתות אש',
      seedKey: 'ppm:fire-doors-annual',
      name: 'Fire doors — annual inspection',
      description: 'In-house visual + hardware test (AS-EITAN).',
      scope: 'building_common', executionMode: 'in_house',
      performerOrgId: asEitan.id, assignedRole: 'fire_safety_officer',
      frequencyMonths: 12, domain: 'fire_life_safety',
      lastDoneDaysAgo: 150,
    },
    {
      match: 'electrical|מתקן חשמל|LV',
      seedKey: 'ppm:main-switchboard-service',
      name: 'Main switchboard — annual maintenance',
      description: 'Ad-hoc vendor with licensed inspector class 3.',
      scope: 'building_common', executionMode: 'ad_hoc_approved',
      assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'electrical',
      lastDoneDaysAgo: 350,
    },
    // HVAC extra coverage
    { match: 'cooling tower|מגדלי קירור', seedKey: 'ppm:cooling-tower-annual', name: 'Cooling tower — annual service', description: 'Contracted HVAC vendor, annual tower clean + treatment check.', scope: 'building_common', executionMode: 'contracted', performerOrgId: chillerVendor.id, contractId: chillerContract.id, assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'hvac', lastDoneDaysAgo: 180 },
    { match: 'chiller efficiency|נצילות אנרגטית', seedKey: 'ppm:chiller-efficiency-3y', name: 'Chiller efficiency survey (every 3y)', description: 'Statutory energy efficiency survey for >100 ton chillers.', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'energy_officer', frequencyMonths: 36, domain: 'energy', lastDoneDaysAgo: 600 },
    { match: 'energy survey|סקר אנרגיה', seedKey: 'ppm:energy-survey-5y', name: 'Energy consumption survey (every 5y)', description: 'Statutory energy survey for buildings > 5.95M kWh.', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'energy_officer', frequencyMonths: 60, domain: 'energy', lastDoneDaysAgo: 1100 },
    { match: 'energy consumption report|דיווח צריכת אנרגיה', seedKey: 'ppm:energy-report-annual', name: 'Annual energy consumption report', description: 'In-house: AS-EITAN energy officer files annual report to Ministry of Energy.', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'energy_officer', frequencyMonths: 12, domain: 'energy', lastDoneDaysAgo: 200 },

    // Fire / life safety — deep coverage
    { match: 'sprinkler|ספרינקלר', seedKey: 'ppm:sprinklers-annual', name: 'Sprinkler system — annual inspection', description: 'Contracted fire vendor. Form 7.', scope: 'building_common', executionMode: 'contracted', performerOrgId: fireVendor.id, contractId: fireContract.id, assignedRole: 'fire_safety_officer', frequencyMonths: 12, domain: 'fire_life_safety', lastDoneDaysAgo: 90 },
    { match: 'preaction|פריאקשן', seedKey: 'ppm:preaction-annual', name: 'Pre-action system — annual test', description: 'Contracted fire vendor.', scope: 'building_common', executionMode: 'contracted', performerOrgId: fireVendor.id, contractId: fireContract.id, assignedRole: 'fire_safety_officer', frequencyMonths: 12, domain: 'fire_life_safety', lastDoneDaysAgo: 220 },
    { match: 'fire water tank|ניקוי פנים מאגר|מאגר כיבוי', seedKey: 'ppm:fire-tank-annual', name: 'Fire water tank — annual cleaning & inspection', description: 'Ad-hoc specialist cleaner & inspection.', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'fire_life_safety', lastDoneDaysAgo: 310 },
    { match: 'hose|זרנוקי בד', seedKey: 'ppm:hoses-annual', name: 'Fabric fire hoses — annual inspection', description: 'Contracted fire vendor. Hydrostatic test every 5 years.', scope: 'building_common', executionMode: 'contracted', performerOrgId: fireVendor.id, contractId: fireContract.id, assignedRole: 'fire_safety_officer', frequencyMonths: 12, domain: 'fire_life_safety', lastDoneDaysAgo: 260 },
    { match: 'extinguishers? — internal|מטפים מטלטלים- בדיקה פנימית', seedKey: 'ppm:extinguishers-internal-quarterly', name: 'Portable extinguishers — quarterly internal check', description: 'In-house visual check by AS-EITAN maintenance.', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'technician', frequencyMonths: 3, domain: 'fire_life_safety', lastDoneDaysAgo: 65 },
    { match: 'extinguishers? — vendor|מטפים מטלטלים- בדיקה ע', seedKey: 'ppm:extinguishers-vendor-annual', name: 'Portable extinguishers — annual vendor service', description: 'Certified maintenance, Form 2.', scope: 'building_common', executionMode: 'contracted', performerOrgId: fireVendor.id, contractId: fireContract.id, assignedRole: 'fire_safety_officer', frequencyMonths: 12, domain: 'fire_life_safety', lastDoneDaysAgo: 120 },
    { match: 'fire damper|דמפרים', seedKey: 'ppm:fire-dampers-annual', name: 'Fire dampers — annual functional test', description: 'Contracted, with registered engineer report (Form 10).', scope: 'building_common', executionMode: 'contracted', performerOrgId: fireVendor.id, contractId: fireContract.id, assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'fire_life_safety', lastDoneDaysAgo: 340 },
    { match: 'fire stopping|איטום מעברי', seedKey: 'ppm:fire-stopping-annual', name: 'Fire stopping — annual visual inspection', description: 'In-house, internal declaration.', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'fire_safety_officer', frequencyMonths: 12, domain: 'fire_life_safety', lastDoneDaysAgo: 180 },
    { match: 'kitchen hood|מנדף מטבח', seedKey: 'ppm:kitchen-hood-semiannual', name: 'Kitchen hood suppression — semiannual', description: 'Contracted specialist (ground-floor restaurants).', scope: 'building_common', executionMode: 'contracted', performerOrgId: fireVendor.id, contractId: fireContract.id, assignedRole: 'fire_safety_officer', frequencyMonths: 6, domain: 'fire_life_safety', lastDoneDaysAgo: 150 },
    { match: 'PA system|כריזה', seedKey: 'ppm:pa-system-annual', name: 'Public address system — annual test', description: 'In-house AS-EITAN test (Form 6).', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'fire_life_safety', lastDoneDaysAgo: 290 },
    { match: 'CO parking|גילוי CO', seedKey: 'ppm:co-detection-annual', name: 'CO detection in parking — annual test', description: 'Manufacturer-certified vendor.', scope: 'building_common', executionMode: 'contracted', performerOrgId: fireVendor.id, contractId: fireContract.id, assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'fire_life_safety', lastDoneDaysAgo: 270 },
    { match: 'fire services inspection|ביקורת שירותי כבאות', seedKey: 'ppm:fire-services-audit', name: 'Fire & rescue services audit', description: 'Regulatory inspection — coordinated by fire_safety_officer.', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'fire_safety_officer', frequencyMonths: 12, domain: 'fire_life_safety', lastDoneDaysAgo: 360 },
    { match: 'lab sprinkler|מערכת ספירנקלרים - אישור מעבדה', seedKey: 'ppm:sprinkler-lab-lifetime', name: 'Sprinkler lab certificate (lifetime)', description: 'One-time lab certification, tracked annually.', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'fire_safety_officer', frequencyMonths: 60, domain: 'fire_life_safety', lastDoneDaysAgo: 1500 },

    // Electrical — wider coverage
    { match: 'aviation lighting|תאורת מטוסים', seedKey: 'ppm:aviation-lighting-annual', name: 'Aviation warning lights — annual check', description: 'Mandatory for 10+ floor buildings. Licensed electrician.', scope: 'building_common', executionMode: 'contracted', performerOrgId: asEitan.id, assignedRole: 'electrician_l3', frequencyMonths: 12, domain: 'electrical', lastDoneDaysAgo: 270 },
    { match: 'HV maintenance|מתח גבוה', seedKey: 'ppm:hv-maintenance-annual', name: 'High-voltage switchgear — annual maintenance', description: 'Ad-hoc HV-qualified electrician.', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'electrician_hv', frequencyMonths: 12, domain: 'electrical', lastDoneDaysAgo: 400 },
    { match: 'generator diesel|איכות סולר', seedKey: 'ppm:diesel-quality-annual', name: 'Generator / fire-pump diesel quality test', description: 'Accredited lab sample every 12 months.', scope: 'building_common', executionMode: 'ad_hoc_approved', performerOrgId: accLab.id, assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'electrical', lastDoneDaysAgo: 80 },
    { match: 'generator service|בדיקת שירות', seedKey: 'ppm:generator-service-annual', name: 'Generator — annual vendor service', description: 'Contracted manufacturer service.', scope: 'building_common', executionMode: 'contracted', performerOrgId: asEitan.id, assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'electrical', lastDoneDaysAgo: 300 },
    { match: 'generator weekly|אישור תקינות גנרטור', seedKey: 'ppm:generator-weekly', name: 'Generator — weekly functional check', description: 'In-house weekly start/stop test.', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'chief_engineer', frequencyMonths: 0.25, domain: 'electrical', lastDoneDaysAgo: 5 },
    { match: 'UPS|אל-פסק|UPS', seedKey: 'ppm:ups-annual', name: 'UPS — annual vendor service', description: 'Contracted battery & inverter service.', scope: 'building_common', executionMode: 'contracted', performerOrgId: asEitan.id, assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'electrical', lastDoneDaysAgo: 220 },
    { match: 'RCD|ממסר פחת', seedKey: 'ppm:rcd-monthly', name: 'RCD (leakage relay) — monthly test', description: 'In-house monthly press-test.', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'technician', frequencyMonths: 1, domain: 'electrical', lastDoneDaysAgo: 20 },
    { match: 'portable electrical|ציוד חשמל מטלטל', seedKey: 'ppm:portable-equipment-annual', name: 'Portable electrical equipment — annual inspection', description: 'Accredited lab.', scope: 'building_common', executionMode: 'ad_hoc_approved', performerOrgId: accLab.id, assignedRole: 'technician', frequencyMonths: 12, domain: 'electrical', lastDoneDaysAgo: 250 },

    // Water & plumbing — extras
    { match: 'grease separator|מפריד שומן', seedKey: 'ppm:grease-separator-quarterly', name: 'Grease separator — quarterly pumpout', description: 'Contracted licensed waste hauler for ground-floor restaurants.', scope: 'building_common', executionMode: 'contracted', performerOrgId: asEitan.id, assignedRole: 'maintenance_coordinator', frequencyMonths: 3, domain: 'water_plumbing', lastDoneDaysAgo: 50 },
    { match: 'drinking water sample|דיגום מי שתיה', seedKey: 'ppm:drinking-water-sample-annual', name: 'Drinking water sampling — annual', description: 'Accredited lab per Ministry of Health.', scope: 'building_common', executionMode: 'ad_hoc_approved', performerOrgId: accLab.id, assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'water_plumbing', lastDoneDaysAgo: 170 },

    // Vertical transport extras
    { match: 'lift certified inspector|בודק מוסמך', seedKey: 'ppm:lift-certified-annual', name: 'Lifts — annual certified inspection', description: 'Regulatory certified inspector (per lift).', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'licensed_lift_inspector', frequencyMonths: 12, domain: 'vertical_transport', lastDoneDaysAgo: 330 },

    // Lifting / pressure
    { match: 'roof crane|מנוף|סל הרמה', seedKey: 'ppm:roof-crane-annual', name: 'Rooftop crane / BMU — annual certified inspection', description: 'Certified lifting-gear inspector.', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'lifting_gear_inspector', frequencyMonths: 12, domain: 'lifting_pressure', lastDoneDaysAgo: 330 },
    { match: 'pressure vessel|קולט אויר', seedKey: 'ppm:pressure-vessels-annual', name: 'Pressure vessels — annual certified inspection', description: 'Certified pressure vessel inspector (pre-action tanks etc.).', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'pressure_vessel_inspector', frequencyMonths: 12, domain: 'lifting_pressure', lastDoneDaysAgo: 300 },

    // Misc / HSE
    { match: 'defibrillator|דפיברילטור', seedKey: 'ppm:defibrillator-monthly', name: 'Defibrillator — monthly visual check', description: 'In-house reception check.', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'technician', frequencyMonths: 1, domain: 'misc_hse', lastDoneDaysAgo: 14 },
    { match: 'height work|עבודה בגובה', seedKey: 'ppm:height-equipment-annual', name: 'Height-work equipment — annual inspection', description: 'Certified lifting-gear inspector.', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'lifting_gear_inspector', frequencyMonths: 12, domain: 'misc_hse', lastDoneDaysAgo: 200 },
    { match: 'mobile ladder|סולמות ניידים', seedKey: 'ppm:mobile-ladders-annual', name: 'Mobile ladders — annual internal check', description: 'In-house inventory check (AS-EITAN).', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'technician', frequencyMonths: 12, domain: 'misc_hse', lastDoneDaysAgo: 210 },
    { match: 'emergency drill|תרגיל חירום', seedKey: 'ppm:emergency-drill-annual', name: 'Emergency drill (fire / evacuation)', description: 'Coordinated drill with tenants.', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'fire_safety_officer', frequencyMonths: 12, domain: 'misc_hse', lastDoneDaysAgo: 150 },
    { match: 'emergency procedures|נוהל חירום', seedKey: 'ppm:emergency-procedures-annual', name: 'Emergency procedures — annual update', description: 'In-house document revision.', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'fire_safety_officer', frequencyMonths: 12, domain: 'misc_hse', lastDoneDaysAgo: 170 },
    { match: 'fuel spill drill|תרגיל טיפול בשפך', seedKey: 'ppm:fuel-spill-drill-annual', name: 'Fuel spill drill — annual', description: 'In-house drill on generator/fuel tank.', scope: 'building_common', executionMode: 'in_house', performerOrgId: asEitan.id, assignedRole: 'chief_engineer', frequencyMonths: 12, domain: 'misc_hse', lastDoneDaysAgo: 330 },

    // Engineer inspections
    { match: 'anchor points|קווי חיים|נקודות עיגון', seedKey: 'ppm:anchor-points-annual', name: 'Life lines & anchor points — annual engineer approval', description: 'Registered mechanical / civil engineer.', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'registered_mechanical_engineer', frequencyMonths: 12, domain: 'engineer_inspections', lastDoneDaysAgo: 220 },
    { match: 'fixed ladders|סולמות קבועים', seedKey: 'ppm:fixed-ladders-annual', name: 'Fixed ladders — annual engineer approval', description: 'Registered civil engineer.', scope: 'building_common', executionMode: 'ad_hoc_approved', assignedRole: 'registered_civil_engineer', frequencyMonths: 12, domain: 'engineer_inspections', lastDoneDaysAgo: 270 },
  ];

  let created = 0;
  for (const s of specs) {
    const obligation = obligations.find((o) => new RegExp(s.match, 'i').test(o.name));
    if (!obligation) {
      console.log(`[ppm] skip "${s.name}" — no matching obligation template for /${s.match}/`);
      continue;
    }
    await ensurePpmProgram(tenantId, building.id, user.id, { obligation, ...s });
    created += 1;
  }

  const counts = await Promise.all([
    prisma.ppmTemplate.count({ where: { buildingId: building.id } }),
    prisma.ppmPlanItem.count({ where: { buildingId: building.id } }),
    prisma.ppmTemplate.count({ where: { buildingId: building.id, executionMode: 'in_house' } }),
    prisma.ppmTemplate.count({ where: { buildingId: building.id, executionMode: 'contracted' } }),
    prisma.ppmTemplate.count({ where: { buildingId: building.id, executionMode: 'ad_hoc_approved' } }),
  ]);
  console.log(`[ppm] building=${building.slug} programs=${counts[0]} plan_items=${counts[1]}`);
  console.log(`[ppm] in_house=${counts[2]} contracted=${counts[3]} ad_hoc=${counts[4]}`);
}

run()
  .catch((err) => { console.error('[ppm] failed', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
