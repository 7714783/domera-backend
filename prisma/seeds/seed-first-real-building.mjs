// Seed the first real building for the bootstrapped superadmin.
// Idempotent: skips if a building with the target slug already exists
// inside the user's first workspace.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OWNER_USERNAME = process.env.FIRST_USER || 'Menivim';
const BUILDING_SLUG = process.env.FIRST_BUILDING_SLUG || 'menivim-kfar-saba';
const BUILDING_NAME = process.env.FIRST_BUILDING_NAME || 'Migdal Menivim Kfar Saba';

async function ensureTenantAndOrg(userId) {
  let membership = await prisma.membership.findFirst({
    where: { userId, roleKey: 'workspace_owner' },
    include: { tenant: true },
  });
  if (!membership) {
    const tenant = await prisma.tenant.create({
      data: {
        slug: 'menivim-portfolio',
        name: 'Menivim Portfolio',
        timezone: 'Asia/Jerusalem',
        status: 'active',
        createdBy: `user:${userId}`,
      },
    });
    await prisma.membership.create({
      data: { tenantId: tenant.id, userId, roleKey: 'workspace_owner', status: 'active' },
    });
    membership = { tenantId: tenant.id, tenant };
  }
  const tenantId = membership.tenantId;

  let org = await prisma.organization.findFirst({ where: { tenantId, type: 'owner' } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        tenantId, name: 'Menivim New REIT Ltd.', slug: 'menivim-reit',
        type: 'owner', status: 'active', createdBy: `user:${userId}`,
      },
    });
    await prisma.organizationMembership.create({
      data: { organizationId: org.id, userId, roleKey: 'org_admin' },
    });
  }
  return { tenantId, organizationId: org.id };
}

async function ensureBuilding(tenantId, organizationId, userId) {
  const existing = await prisma.building.findUnique({
    where: { tenantId_slug: { tenantId, slug: BUILDING_SLUG } },
  });
  if (existing) return existing;

  const building = await prisma.building.create({
    data: {
      tenantId, organizationId,
      slug: BUILDING_SLUG,
      name: BUILDING_NAME,
      buildingCode: 'MMM',
      addressLine1: 'Raanana South Junction, Kfar Saba',
      city: 'Kfar Saba',
      countryCode: 'IL',
      timezone: 'Asia/Jerusalem',
      type: 'Office',
      buildingType: 'mixed_use',
      primaryUse: 'office',
      secondaryUses: ['retail', 'food_and_beverage', 'parking'],
      complexityFlags: ['high_rise_like', 'multi_tenant_office', 'complex_mep', 'mixed_use'],
      floorsAboveGround: 20,
      floorsBelowGround: 5,
      hasParking: true,
      hasRestaurantsGroundFloor: true,
      hasRooftopMechanical: true,
      notes: '~25,000 m² gross; ground floor ~1,300–1,500 m² retail/F&B; near Raanana South train station; curtain-wall facade; green building standards; units from ~90 m² fully finished.',
      status: 'active',
      createdBy: `user:${userId}`,
    },
  });

  await prisma.buildingSettings.create({
    data: { buildingId: building.id, currency: 'ILS', timezone: 'Asia/Jerusalem', billingCycle: 'monthly', locale: 'he' },
  });
  await prisma.buildingMandate.create({
    data: { tenantId, buildingId: building.id, organizationId, mandateType: 'owner', effectiveFrom: new Date() },
  });
  await prisma.buildingRoleAssignment.create({
    data: { tenantId, buildingId: building.id, userId, roleKey: 'building_manager', delegatedBy: userId },
  });

  return building;
}

function floorTypeFor(n) {
  if (n <= -3) return 'parking';
  if (n === -2 || n === -1) return 'parking';
  if (n === 0) return 'lobby_commercial';
  if (n >= 1 && n <= 19) return 'office';
  if (n === 20) return 'technical';
  return 'technical';
}

function floorCodeFor(n) {
  if (n < 0) return `B${Math.abs(n)}`;
  if (n === 0) return 'G';
  return String(n).padStart(2, '0');
}

async function ensureFloors(tenantId, buildingId) {
  const existing = await prisma.buildingFloor.count({ where: { buildingId } });
  if (existing > 0) return;
  for (let n = -5; n <= 20; n++) {
    await prisma.buildingFloor.create({
      data: {
        tenantId, buildingId,
        floorCode: floorCodeFor(n),
        floorNumber: n,
        floorType: floorTypeFor(n),
        label: n === 0 ? 'Ground floor / lobby & restaurants' : null,
        isActive: true,
      },
    });
  }
}

async function ensureOfficeUnits(tenantId, buildingId) {
  const officeFloors = await prisma.buildingFloor.findMany({
    where: { buildingId, floorType: 'office' },
    orderBy: { floorNumber: 'asc' },
  });
  for (const f of officeFloors) {
    const existing = await prisma.buildingUnit.count({ where: { floorId: f.id } });
    if (existing > 0) continue;
    for (let i = 1; i <= 8; i++) {
      await prisma.buildingUnit.create({
        data: {
          tenantId, buildingId, floorId: f.id,
          unitCode: `${f.floorCode}-${String(i).padStart(2, '0')}`,
          unitType: 'office',
          isDivisible: true,
          status: 'vacant',
          layoutZone: `zone-${i}`,
        },
      });
    }
  }
}

async function ensureTransport(tenantId, buildingId) {
  const existing = await prisma.buildingVerticalTransport.count({ where: { buildingId } });
  if (existing > 0) return;
  const rows = [
    { code: 'PE-6x', transportType: 'passenger_elevator', servesFromFloor: 0,  servesToFloor: 19, quantity: 6, notes: '6 passenger elevators serving G..19' },
    { code: 'FE-1',  transportType: 'freight_elevator',   servesFromFloor: -4, servesToFloor: 20, quantity: 1, notes: 'Freight elevator -4..20' },
    { code: 'PL-2',  transportType: 'parking_lift',       servesFromFloor: -5, servesToFloor: 0,  quantity: 2, notes: 'Two parking lifts G..-5' },
  ];
  for (const r of rows) {
    await prisma.buildingVerticalTransport.create({ data: { tenantId, buildingId, ...r } });
  }
}

async function ensureSystems(tenantId, buildingId) {
  const existing = await prisma.buildingSystem.count({ where: { buildingId } });
  if (existing > 0) return;

  const rooftop = await prisma.buildingFloor.findFirst({ where: { buildingId, floorNumber: 20 } });
  const ground = await prisma.buildingFloor.findFirst({ where: { buildingId, floorNumber: 0 } });
  const b5 = await prisma.buildingFloor.findFirst({ where: { buildingId, floorNumber: -5 } });

  const rows = [
    // HVAC — chillers
    { systemCategory: 'hvac', systemCode: 'CHILLER-01', name: 'Rooftop chiller #1', locationType: 'roof', floorId: rooftop?.id, quantity: 1 },
    { systemCategory: 'hvac', systemCode: 'CHILLER-02', name: 'Rooftop chiller #2', locationType: 'roof', floorId: rooftop?.id, quantity: 1 },
    { systemCategory: 'hvac', systemCode: 'CHILLER-03', name: 'Rooftop chiller #3', locationType: 'roof', floorId: rooftop?.id, quantity: 1 },
    { systemCategory: 'hvac', systemCode: 'CHILLER-04', name: 'Rooftop chiller #4', locationType: 'roof', floorId: rooftop?.id, quantity: 1 },

    // Ventilation — various
    { systemCategory: 'ventilation', systemCode: 'VENT-TOILET-01', name: 'Toilet exhaust fan set', locationType: 'roof', floorId: rooftop?.id, quantity: 3, notes: '3 extraction fans for toilets' },
    { systemCategory: 'ventilation', systemCode: 'VENT-RESTO-01', name: 'Ground-floor restaurant exhaust (mindafim)', locationType: 'roof', floorId: rooftop?.id, notes: 'Serves ground-floor restaurants' },
    { systemCategory: 'smoke_extraction', systemCode: 'SMOKE-EXT-01', name: 'Smoke extraction fans', locationType: 'roof', floorId: rooftop?.id, notes: 'Activated on fire alarm' },
    { systemCategory: 'stair_pressurization', systemCode: 'STAIR-PRESS-01', name: 'Stair pressurization fans', locationType: 'roof', floorId: rooftop?.id, quantity: 2, notes: 'Two fans pressurizing staircases' },

    // Electrical
    { systemCategory: 'electrical', systemCode: 'UTILITY-FEED-01', name: 'Utility feed (shnai hevrat hashmal)', locationType: 'electrical_room', notes: 'Main utility feed(s) — detailed count TBD' },
    { systemCategory: 'electrical', systemCode: 'MAIN-ELEC-ROOM', name: 'Main electrical room', locationType: 'electrical_room' },
    { systemCategory: 'electrical', systemCode: 'GENERATOR-01', name: 'Emergency generator', locationType: 'electrical_room' },

    // Water & fire — basement
    { systemCategory: 'plumbing', systemCode: 'DW-PUMP-01', name: 'Drinking water pump #1', locationType: 'basement', floorId: b5?.id, quantity: 1, notes: 'Pump room on -5' },
    { systemCategory: 'plumbing', systemCode: 'DW-PUMP-02', name: 'Drinking water pump #2', locationType: 'basement', floorId: b5?.id, quantity: 1, notes: 'Pump room on -5' },
    { systemCategory: 'fire_safety', systemCode: 'FIRE-PUMP-01', name: 'Fire sprinkler pump', locationType: 'basement', floorId: b5?.id, quantity: 1, notes: 'Pump room on -5' },

    // Amenity / facade / sustainability — from Menivim REIT public site
    { systemCategory: 'amenity', systemCode: 'LOBBY-MAIN', name: 'Main designed lobby', locationType: 'ground_floor' },
    { systemCategory: 'amenity', systemCode: 'LOBBY-FLOOR', name: 'Per-floor designed lobby', locationType: 'office_floor' },
    { systemCategory: 'amenity', systemCode: 'SHOWERS', name: 'Employee shower facilities', locationType: 'basement' },
    { systemCategory: 'facade', systemCode: 'CURTAIN-WALL', name: 'Floor-to-ceiling glass curtain wall', locationType: 'envelope' },
    { systemCategory: 'parking', systemCode: 'BIKE-PARK', name: 'Bicycle & motorcycle parking', locationType: 'basement' },
    { systemCategory: 'sustainability', systemCode: 'GREEN-BLDG', name: 'Green building standards', locationType: 'whole_building' },
  ];

  for (const r of rows) {
    await prisma.buildingSystem.create({
      data: {
        tenantId, buildingId,
        ...r,
        floorId: r.floorId || null,
        status: 'active',
      },
    });
  }
}

async function run() {
  const user = await prisma.user.findUnique({ where: { username: OWNER_USERNAME } });
  if (!user) {
    console.error(`[first-building] user ${OWNER_USERNAME} not found — run reset-and-bootstrap first.`);
    process.exit(1);
  }

  const { tenantId, organizationId } = await ensureTenantAndOrg(user.id);
  const building = await ensureBuilding(tenantId, organizationId, user.id);
  await ensureFloors(tenantId, building.id);
  await ensureOfficeUnits(tenantId, building.id);
  await ensureTransport(tenantId, building.id);
  await ensureSystems(tenantId, building.id);

  const counts = await Promise.all([
    prisma.buildingFloor.count({ where: { buildingId: building.id } }),
    prisma.buildingUnit.count({ where: { buildingId: building.id } }),
    prisma.buildingVerticalTransport.findMany({ where: { buildingId: building.id } }),
    prisma.buildingSystem.count({ where: { buildingId: building.id } }),
  ]);
  const liftsTotal = counts[2].reduce((a, b) => a + b.quantity, 0);
  console.log(
    `[first-building] ${building.slug} — floors=${counts[0]} units=${counts[1]} lifts=${liftsTotal} systems=${counts[3]}`,
  );
}

run()
  .catch((err) => { console.error('[first-building] failed', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
