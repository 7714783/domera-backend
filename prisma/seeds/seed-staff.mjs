// Seed the staff of Migdal Menivim Kfar Saba — from the operations manager
// to cleaners. Idempotent: each user is keyed by emailNormalized; assignments
// are uniquely constrained by (buildingId, userId, roleKey).

import * as bcryptModule from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const bcrypt = bcryptModule.default || bcryptModule;
const prisma = new PrismaClient();

const BUILDING_SLUG = process.env.FIRST_BUILDING_SLUG || 'menivim-kfar-saba';
const DEFAULT_PASSWORD = process.env.STAFF_DEFAULT_PASSWORD || 'demo-password';

// Role key → {org slug (inside workspace), title, certifications[]}
// Organization slugs must match seed-first-real-building and seed-ppm-programs.
const STAFF = [
  // ── AS-EITAN facility management (most roles) ──
  {
    displayName: 'Eitan Shapira',
    username: 'eshapira',
    email: 'eitan.shapira@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'building_manager',
    title: 'Building Manager / CEO AS-EITAN',
  },
  {
    displayName: 'Ronen Levi',
    username: 'rlevi',
    email: 'ronen.levi@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'chief_engineer',
    title: 'Chief Engineer',
    certs: ['electrician_l3', 'registered_mechanical_engineer'],
  },
  {
    displayName: 'Dana Cohen',
    username: 'dcohen',
    email: 'dana.cohen@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'fire_safety_officer',
    title: 'Fire Safety Officer (Mem. Betichut Esh)',
    certs: ['fire_safety_inspector'],
  },
  {
    displayName: 'Amir Ben-David',
    username: 'abendavid',
    email: 'amir.bendavid@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'energy_officer',
    title: 'Energy Officer',
    certs: ['licensed_energy_surveyor'],
  },
  {
    displayName: 'Noa Katz',
    username: 'nkatz',
    email: 'noa.katz@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'maintenance_coordinator',
    title: 'Maintenance Coordinator',
  },
  {
    displayName: 'Yossi Malka',
    username: 'ymalka',
    email: 'yossi.malka@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'document_controller',
    title: 'Document Controller',
  },
  {
    displayName: 'Liat Mizrahi',
    username: 'lmizrahi',
    email: 'liat.mizrahi@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'finance_controller',
    title: 'Finance Controller',
  },
  {
    displayName: 'Itai Rosen',
    username: 'irosen',
    email: 'itai.rosen@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'project_manager',
    title: 'Project Manager (CAPEX)',
  },
  {
    displayName: 'Boris Volkov',
    username: 'bvolkov',
    email: 'boris.volkov@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'technician',
    title: 'Lead Maintenance Technician',
    certs: ['electrician_l3'],
  },
  {
    displayName: 'Sergio Abramov',
    username: 'sabramov',
    email: 'sergio.abramov@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'technician',
    title: 'HVAC / Plumbing Technician',
  },
  {
    displayName: 'Marta Gonzalez',
    username: 'mgonzalez',
    email: 'marta.gonzalez@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'cleaner',
    title: 'Cleaning Lead',
  },
  {
    displayName: 'Elena Petrova',
    username: 'epetrova',
    email: 'elena.petrova@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'cleaner',
    title: 'Cleaner',
  },
  {
    displayName: 'Maria Santos',
    username: 'msantos',
    email: 'maria.santos@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'cleaner',
    title: 'Cleaner',
  },
  {
    displayName: 'David Azulay',
    username: 'dazulay',
    email: 'david.azulay@as-eitan.example.com',
    orgSlug: 'as-eitan',
    roleKey: 'viewer',
    title: 'Security Supervisor (24/7)',
  },

  // ── Owner / REIT side ──
  {
    displayName: 'Eyal Almog',
    username: 'ealmog',
    email: 'eyal.almog@menivim-reit.example.com',
    orgSlug: 'menivim-reit',
    roleKey: 'owner_representative',
    title: 'Owner Representative · Menivim REIT',
  },
  {
    displayName: 'Shira Gal',
    username: 'sgal',
    email: 'shira.gal@menivim-reit.example.com',
    orgSlug: 'menivim-reit',
    roleKey: 'auditor',
    title: 'Internal Audit · Menivim REIT',
  },

  // ── External vendors (limited scope) ──
  {
    displayName: 'Tal Barnea',
    username: 'tbarnea',
    email: 'tal.barnea@chiller-service-co.example.com',
    orgSlug: 'chiller-service-co',
    roleKey: 'vendor_user',
    title: 'Chiller Service Technician',
    certs: ['registered_mechanical_engineer'],
  },
  {
    displayName: 'Avi Rahamim',
    username: 'arahamim',
    email: 'avi.rahamim@fire-rescue-maintenance.example.com',
    orgSlug: 'fire-rescue-maintenance',
    roleKey: 'vendor_user',
    title: 'Fire System Technician',
    certs: ['fire_safety_inspector'],
  },
  {
    displayName: 'Yaron Shiloh',
    username: 'yshiloh',
    email: 'yaron.shiloh@lift-services-israel.example.com',
    orgSlug: 'lift-services-israel',
    roleKey: 'vendor_user',
    title: 'Lift Technician',
    certs: ['licensed_lift_inspector'],
  },
  {
    displayName: 'Dr. Rivka Feld',
    username: 'rfeld',
    email: 'rivka.feld@accredited-water-lab.example.com',
    orgSlug: 'accredited-water-lab',
    roleKey: 'vendor_user',
    title: 'Water Lab Analyst',
    certs: ['accredited_lab', 'certified_disinfector'],
  },
];

async function ensureUser(data) {
  const emailNormalized = data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { emailNormalized } });
  if (existing) return existing;
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  return prisma.user.create({
    data: {
      email: data.email,
      emailNormalized,
      username: data.username,
      passwordHash,
      displayName: data.displayName,
      status: 'active',
      createdBy: 'seed:staff',
    },
  });
}

async function ensureOrgMembership(orgId, userId, roleKey) {
  return prisma.organizationMembership.upsert({
    where: { organizationId_userId_roleKey: { organizationId: orgId, userId, roleKey } },
    create: { organizationId: orgId, userId, roleKey },
    update: {},
  });
}

async function ensureBuildingRole(tenantId, buildingId, userId, roleKey, delegatedBy) {
  return prisma.buildingRoleAssignment.upsert({
    where: { buildingId_userId_roleKey: { buildingId, userId, roleKey } },
    create: { tenantId, buildingId, userId, roleKey, delegatedBy },
    update: {},
  });
}

async function ensureCertification(userId, certKey) {
  const cert = await prisma.certification.findUnique({ where: { key: certKey } });
  if (!cert) return null;
  return prisma.userCertification.upsert({
    where: { userId_certificationId: { userId, certificationId: cert.id } },
    create: {
      userId,
      certificationId: cert.id,
      issuedAt: new Date(Date.now() - 200 * 86400000),
      expiresAt: new Date(Date.now() + 500 * 86400000),
    },
    update: {},
  });
}

async function run() {
  const building = await prisma.building.findFirst({ where: { slug: BUILDING_SLUG } });
  if (!building) {
    console.error('building not found:', BUILDING_SLUG);
    process.exit(1);
  }
  const tenantId = building.tenantId;

  const bootstrap = await prisma.user.findFirst({ where: { username: 'Menivim' } });
  const delegator = bootstrap?.id || 'seed:staff';

  const orgs = await prisma.organization.findMany({ where: { tenantId } });
  const orgBySlug = new Map(orgs.map((o) => [o.slug, o]));

  let created = 0,
    skipped = 0,
    certsAdded = 0;

  for (const s of STAFF) {
    const org = orgBySlug.get(s.orgSlug);
    if (!org) {
      console.warn(`[staff] missing org ${s.orgSlug} — skipping ${s.displayName}`);
      skipped++;
      continue;
    }
    const role = await prisma.role.findUnique({ where: { key: s.roleKey } });
    if (!role) {
      console.warn(`[staff] missing role ${s.roleKey} — skipping ${s.displayName}`);
      skipped++;
      continue;
    }

    const before = await prisma.user.findUnique({
      where: { emailNormalized: s.email.toLowerCase() },
    });
    const user = await ensureUser(s);
    const isNew = !before;
    await ensureOrgMembership(org.id, user.id, s.roleKey);
    await ensureBuildingRole(tenantId, building.id, user.id, s.roleKey, delegator);
    for (const c of s.certs || []) {
      const added = await ensureCertification(user.id, c);
      if (added) certsAdded++;
    }
    if (isNew) created++;
    else skipped++;
  }

  const counts = await prisma.buildingRoleAssignment.groupBy({
    by: ['roleKey'],
    where: { buildingId: building.id },
    _count: { _all: true },
  });
  const totalAssigns = await prisma.buildingRoleAssignment.count({
    where: { buildingId: building.id },
  });
  console.log(
    `[staff] building=${BUILDING_SLUG} created_users=${created} reused=${skipped} certs_added=${certsAdded} total_assignments=${totalAssigns}`,
  );
  for (const r of counts.sort((a, b) => a.roleKey.localeCompare(b.roleKey))) {
    console.log(`  · ${r.roleKey.padEnd(28)} ${r._count._all}`);
  }
  console.log(`[staff] Default login password: "${DEFAULT_PASSWORD}" — change in production.`);
}

run()
  .catch((err) => {
    console.error('[staff] failed', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
