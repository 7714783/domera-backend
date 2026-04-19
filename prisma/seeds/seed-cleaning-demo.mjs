#!/usr/bin/env node
// Dev seed for the Cleaning Module. Creates two contractors (A + B), zones,
// staff hierarchy (boss → manager → supervisor → cleaner), and one QR point.
// Safe to re-run (upserts by natural keys).

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_MIGRATOR || process.env.DATABASE_URL } },
});

const ROLES = ['boss', 'manager', 'supervisor', 'cleaner', 'dispatcher'];
const ROLE_NAMES = {
  boss: 'Cleaning Boss', manager: 'Cleaning Manager',
  supervisor: 'Cleaning Supervisor', cleaner: 'Cleaner',
  dispatcher: 'Cleaning Dispatcher',
};

async function upsertContractor(tenantId, buildingId, name, legalName) {
  const existing = await prisma.cleaningContractor.findFirst({ where: { buildingId, name } });
  if (existing) return existing;
  const c = await prisma.cleaningContractor.create({
    data: { tenantId, buildingId, name, legalName, phone: '+972-3-000-0000', email: `ops@${name.toLowerCase().replace(/[^a-z]/g, '')}.example` },
  });
  for (const code of ROLES) {
    await prisma.cleaningRole.create({ data: { tenantId, contractorId: c.id, code, name: ROLE_NAMES[code] } });
  }
  return c;
}

async function upsertStaff(tenantId, contractor, roleCode, fullName, managerId) {
  const role = await prisma.cleaningRole.findUnique({
    where: { contractorId_code: { contractorId: contractor.id, code: roleCode } },
  });
  const existing = await prisma.cleaningStaff.findFirst({
    where: { tenantId, contractorId: contractor.id, fullName },
  });
  if (existing) return existing;
  return prisma.cleaningStaff.create({
    data: {
      tenantId, contractorId: contractor.id, roleId: role.id,
      fullName, managerId: managerId || null,
    },
  });
}

async function upsertZone(tenantId, buildingId, code, name, zoneType, contractorId, supervisorStaffId) {
  const existing = await prisma.cleaningZone.findFirst({ where: { buildingId, code } });
  if (existing) {
    return prisma.cleaningZone.update({
      where: { id: existing.id },
      data: { contractorId, supervisorStaffId, name, zoneType },
    });
  }
  return prisma.cleaningZone.create({
    data: { tenantId, buildingId, code, name, zoneType, contractorId, supervisorStaffId },
  });
}

async function upsertQr(tenantId, buildingId, zoneId, label) {
  const existing = await prisma.cleaningQrPoint.findFirst({ where: { zoneId, label } });
  if (existing) return existing;
  const code = Math.random().toString(36).slice(2, 12);
  const base = process.env.APP_URL || 'http://localhost:3000';
  return prisma.cleaningQrPoint.create({
    data: {
      tenantId, buildingId, zoneId, code, label,
      publicUrl: `${base}/qr/cleaning/${code}`,
    },
  });
}

async function run() {
  const building = await prisma.building.findFirst({ where: { slug: 'menivim-kfar-saba' } });
  if (!building) throw new Error('building menivim-kfar-saba not found — seed the test building first');
  const tenantId = building.tenantId;

  const contractorA = await upsertContractor(tenantId, building.id, 'CleanPro A', 'CleanPro A Ltd.');
  const contractorB = await upsertContractor(tenantId, building.id, 'SparkleCo B', 'SparkleCo B Ltd.');

  // Staff hierarchy for contractor A: boss → manager → supervisor → cleaner
  const bossA = await upsertStaff(tenantId, contractorA, 'boss', 'Aaron Boss');
  const managerA = await upsertStaff(tenantId, contractorA, 'manager', 'Anna Manager', bossA.id);
  const supervisorA = await upsertStaff(tenantId, contractorA, 'supervisor', 'Avi Supervisor', managerA.id);
  const cleanerA = await upsertStaff(tenantId, contractorA, 'cleaner', 'Adam Cleaner', supervisorA.id);

  // Staff hierarchy for contractor B
  const bossB = await upsertStaff(tenantId, contractorB, 'boss', 'Ben Boss');
  const managerB = await upsertStaff(tenantId, contractorB, 'manager', 'Bella Manager', bossB.id);
  const cleanerB = await upsertStaff(tenantId, contractorB, 'cleaner', 'Boris Cleaner', managerB.id);

  // Zones
  const floor1 = await upsertZone(tenantId, building.id, 'F1', 'Floor 1', 'floor', contractorA.id, supervisorA.id);
  const floor2 = await upsertZone(tenantId, building.id, 'F2', 'Floor 2', 'floor', contractorB.id, null);
  const wc3 = await upsertZone(tenantId, building.id, 'WC-3', 'Restroom 3rd floor', 'wc', contractorA.id, supervisorA.id);

  // QR point on the 3rd-floor restroom
  const qr = await upsertQr(tenantId, building.id, wc3.id, 'Restroom 3F — QR');

  // One sample request via admin to validate wiring
  const exists = await prisma.cleaningRequest.findFirst({ where: { zoneId: wc3.id, title: 'Initial paper roll restock' } });
  if (!exists) {
    await prisma.cleaningRequest.create({
      data: {
        tenantId, buildingId: building.id, zoneId: wc3.id,
        title: 'Initial paper roll restock',
        description: 'Seeded demo request.',
        category: 'regular_cleaning', priority: 'normal', source: 'admin',
        contractorId: contractorA.id, assignedStaffId: supervisorA.id,
        status: 'assigned', assignedAt: new Date(),
      },
    });
  }

  console.log(JSON.stringify({
    ok: true,
    building: { id: building.id, slug: building.slug, name: building.name },
    contractors: [{ id: contractorA.id, name: contractorA.name }, { id: contractorB.id, name: contractorB.name }],
    staff: {
      A: { bossA: bossA.id, managerA: managerA.id, supervisorA: supervisorA.id, cleanerA: cleanerA.id },
      B: { bossB: bossB.id, managerB: managerB.id, cleanerB: cleanerB.id },
    },
    zones: { floor1: floor1.id, floor2: floor2.id, wc3: wc3.id },
    qrPoint: { id: qr.id, code: qr.code, publicUrl: qr.publicUrl },
  }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
