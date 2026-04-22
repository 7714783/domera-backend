import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

const root = process.cwd();
// Split-repo lives at repo root (prisma/seeds/...), monorepo lives at apps/api/prisma/seeds/...
const candidates = [
  path.join(root, 'prisma', 'seeds', 'test-building.seed.json'),
  path.join(root, 'apps', 'api', 'prisma', 'seeds', 'test-building.seed.json'),
];
const manifestPath = candidates.find((p) => fs.existsSync(p)) || candidates[0];

function assertDevGuards() {
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('seed aborted: NODE_ENV=production');
  }

  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('seed aborted: ALLOW_DEMO_SEED must be true');
  }

  const databaseUrl = process.env.DATABASE_URL || '';
  const localLike = /(localhost|127\.0\.0\.1|postgres|docker|dev)/i.test(databaseUrl);
  if (!localLike && process.env.ALLOW_NONLOCAL_DEMO_SEED !== 'true') {
    throw new Error('seed aborted: DATABASE_URL is non-local and ALLOW_NONLOCAL_DEMO_SEED is not true');
  }

  if (process.env.DEMO_DISABLE_EMAIL !== 'true' || process.env.DEMO_DISABLE_SMS !== 'true' || process.env.DEMO_DISABLE_WEBHOOKS !== 'true') {
    throw new Error('seed aborted: DEMO_DISABLE_EMAIL/DEMO_DISABLE_SMS/DEMO_DISABLE_WEBHOOKS must be true');
  }
}

function sid(seedKey, prefix) {
  const hash = crypto.createHash('sha1').update(seedKey).digest('hex').slice(0, 16);
  return `${prefix}_${hash}`;
}

function parseRule(rule) {
  const out = { freq: 'MONTHLY', interval: 1 };
  for (const part of (rule || '').split(';')) {
    const [k, v] = part.split('=');
    if (k === 'FREQ' && v) out.freq = v;
    if (k === 'INTERVAL' && v) out.interval = Number(v);
  }
  return out;
}

function addByRule(date, parsed) {
  const d = new Date(date);
  if (parsed.freq === 'DAILY') {
    d.setDate(d.getDate() + parsed.interval);
    return d;
  }
  if (parsed.freq === 'YEARLY') {
    d.setFullYear(d.getFullYear() + parsed.interval);
    return d;
  }
  d.setMonth(d.getMonth() + parsed.interval);
  return d;
}

function requireReservedDomains(manifest) {
  if (process.env.DEMO_ONLY_RESERVED_DOMAINS !== 'true') return;
  const reserved = /(@example\.com$|\.example\.com$|\.test$)/i;
  for (const user of manifest.users) {
    if (!reserved.test(user.email)) {
      throw new Error(`seed aborted: non-reserved email domain: ${user.email}`);
    }
  }
}

async function resetTenantData(tenantId) {
  const buildingIds = (await prisma.building.findMany({ where: { tenantId }, select: { id: true } })).map((x) => x.id);
  const organizationIds = (await prisma.organization.findMany({ where: { tenantId }, select: { id: true } })).map((x) => x.id);

  await prisma.auditEntry.deleteMany({ where: { tenantId } });
  await prisma.document.deleteMany({ where: { tenantId } });
  await prisma.approvalStep.deleteMany({ where: { request: { tenantId } } });
  await prisma.approvalRequest.deleteMany({ where: { tenantId } });
  await prisma.invoice.deleteMany({ where: { tenantId } });
  await prisma.budgetLine.deleteMany({ where: { budget: { tenantId } } });
  await prisma.budget.deleteMany({ where: { tenantId } });
  await prisma.taskInstance.deleteMany({ where: { tenantId } });
  await prisma.ppmPlanItem.deleteMany({ where: { tenantId } });
  await prisma.ppmTemplate.deleteMany({ where: { tenantId } });
  await prisma.buildingObligation.deleteMany({ where: { tenantId } });
  await prisma.obligationTemplate.deleteMany({ where: { tenantId } });
  await prisma.asset.deleteMany({ where: { tenantId } });
  await prisma.building.deleteMany({ where: { tenantId } });

  if (organizationIds.length) {
    await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
  }
  await prisma.organization.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { isDemo: true } });

  if (!buildingIds.length) {
    // noop; kept for clarity
  }
}

async function run() {
  assertDevGuards();

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`seed manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  requireReservedDomains(manifest);

  const tenantId = 'ten_demo';
  const seedName = process.env.DEMO_SEED_NAME || 'test-building';
  const seedVersion = process.env.DEMO_SEED_VERSION || '2026-04-18';
  const checksum = crypto.createHash('sha1').update(JSON.stringify(manifest)).digest('hex');

  await prisma.seedRun.upsert({
    where: { seedName_seedVersion: { seedName, seedVersion } },
    create: {
      tenantId: null,
      seedName,
      seedVersion,
      status: 'started',
      checksum,
      startedAt: new Date(),
      createdBy: 'seed:test-building',
    },
    update: {
      tenantId: null,
      status: 'started',
      checksum,
      startedAt: new Date(),
      finishedAt: null,
      errorText: null,
    },
  });

  await prisma.tenant.upsert({
    where: { id: tenantId },
    create: {
      id: tenantId,
      slug: manifest.workspace.slug,
      name: manifest.workspace.name,
      timezone: manifest.workspace.timezone,
      defaultUiLocale: manifest.workspace.default_locale,
      defaultContentLocale: manifest.workspace.default_locale,
      isDemo: true,
      seedKey: manifest.workspace.seed_key,
      createdBy: 'seed:test-building',
    },
    update: {
      slug: manifest.workspace.slug,
      name: manifest.workspace.name,
      timezone: manifest.workspace.timezone,
      defaultUiLocale: manifest.workspace.default_locale,
      defaultContentLocale: manifest.workspace.default_locale,
      isDemo: true,
      seedKey: manifest.workspace.seed_key,
      createdBy: 'seed:test-building',
    },
  });

  await resetTenantData(tenantId);

  const orgSeedToId = new Map();
  for (const org of manifest.organizations) {
    const id = sid(org.seed_key, 'org');
    orgSeedToId.set(org.seed_key, id);

    await prisma.organization.create({
      data: {
        id,
        tenantId,
        name: org.name,
        slug: org.slug,
        type: org.type,
        compliance: org.type === 'vendor' ? 88 : 94,
        status: org.type === 'vendor' ? 'watch' : 'healthy',
        isDemo: true,
        seedKey: org.seed_key,
        createdBy: 'seed:test-building',
      },
    });
  }

  const userSeedToId = new Map();
  for (const user of manifest.users) {
    const id = sid(user.seed_key, 'usr');
    userSeedToId.set(user.seed_key, id);

    await prisma.user.create({
      data: {
        id,
        email: user.email,
        emailNormalized: user.email.toLowerCase(),
        displayName: user.display_name,
        isDemo: true,
        seedKey: user.seed_key,
        createdBy: 'seed:test-building',
      },
    });

    for (const role of user.roles) {
      await prisma.membership.create({
        data: {
          id: sid(`mem:${user.seed_key}:${role}`, 'mem'),
          tenantId,
          userId: id,
          roleKey: role,
          status: 'active',
        },
      });
    }

    await prisma.organizationMembership.create({
      data: {
        id: sid(`om:${user.seed_key}`, 'om'),
        organizationId: orgSeedToId.get(user.org_seed_key),
        userId: id,
        roleKey: user.roles[0] || 'viewer',
      },
    });
  }

  const buildingId = sid(manifest.building.seed_key, 'bld');
  await prisma.building.create({
    data: {
      id: buildingId,
      tenantId,
      organizationId: orgSeedToId.get('org_operator_atlas') || null,
      slug: manifest.building.slug,
      name: manifest.building.name,
      timezone: manifest.building.timezone,
      countryCode: manifest.building.country_code,
      city: manifest.building.city,
      addressLine1: manifest.building.address_line_1,
      defaultContentLocale: 'en',
      type: 'Commercial',
      compliance: 86,
      mandates: 12,
      status: 'warning',
      floorsCount: 10,
      annualKwh: 6200000,
      attributes: { primary_use: 'office', has_kitchen_hood: true, has_parking_garage: true },
      isDemo: true,
      seedKey: manifest.building.seed_key,
      createdBy: 'seed:test-building',
    },
  });

  const ownerOrgId = orgSeedToId.get('org_owner_northstone');
  const operatorOrgId = orgSeedToId.get('org_operator_atlas');
  if (ownerOrgId) {
    await prisma.buildingMandate.upsert({
      where: { seedKey: 'mnd_owner_nt01' },
      create: {
        tenantId, buildingId, organizationId: ownerOrgId, mandateType: 'owner',
        effectiveFrom: new Date(), isDemo: true, seedKey: 'mnd_owner_nt01',
      },
      update: {},
    });
  }
  if (operatorOrgId) {
    await prisma.buildingMandate.upsert({
      where: { seedKey: 'mnd_operator_nt01' },
      create: {
        tenantId, buildingId, organizationId: operatorOrgId, mandateType: 'management_company',
        effectiveFrom: new Date(), isDemo: true, seedKey: 'mnd_operator_nt01',
      },
      update: {},
    });
  }

  const certMap = {
    usr_chief_engineer: ['electrician_l3', 'registered_mechanical_engineer'],
    usr_vendor_tech: ['accredited_lab', 'fire_safety_inspector'],
  };
  for (const [userSeed, certKeys] of Object.entries(certMap)) {
    const userId = userSeedToId.get(userSeed);
    if (!userId) continue;
    for (const key of certKeys) {
      const cert = await prisma.certification.findUnique({ where: { key } });
      if (!cert) continue;
      await prisma.userCertification.upsert({
        where: { userId_certificationId: { userId, certificationId: cert.id } },
        create: {
          userId, certificationId: cert.id,
          issuedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() + 500 * 24 * 60 * 60 * 1000),
        },
        update: {},
      });
    }
  }

  const assetSeedToId = new Map();
  for (const asset of manifest.assets) {
    assetSeedToId.set(asset.seed_key, sid(asset.seed_key, 'ast'));
  }

  for (const asset of manifest.assets.filter((a) => !a.parent_seed_key)) {
    await prisma.asset.create({
      data: {
        id: assetSeedToId.get(asset.seed_key),
        tenantId,
        buildingId,
        name: asset.name,
        class: asset.class,
        parentAssetId: null,
        isDemo: true,
        seedKey: asset.seed_key,
        createdBy: 'seed:test-building',
      },
    });
  }
  for (const asset of manifest.assets.filter((a) => a.parent_seed_key)) {
    await prisma.asset.create({
      data: {
        id: assetSeedToId.get(asset.seed_key),
        tenantId,
        buildingId,
        name: asset.name,
        class: asset.class,
        parentAssetId: assetSeedToId.get(asset.parent_seed_key),
        isDemo: true,
        seedKey: asset.seed_key,
        createdBy: 'seed:test-building',
      },
    });
  }

  const obligations = [];
  for (const obligation of manifest.obligation_templates) {
    const id = sid(obligation.seed_key, 'obl');
    obligations.push({ ...obligation, id });
    await prisma.obligationTemplate.create({
      data: {
        id,
        tenantId,
        assetId: assetSeedToId.get(obligation.asset_seed_key) || null,
        name: obligation.name,
        basisType: obligation.basis_type,
        recurrenceRule: obligation.recurrence_rule,
        requiresEvidence: obligation.requires_evidence,
        isDemo: true,
        seedKey: obligation.seed_key,
        createdBy: 'seed:test-building',
      },
    });

    await prisma.buildingObligation.create({
      data: {
        id: sid(`bo:${obligation.seed_key}`, 'bog'),
        tenantId,
        buildingId,
        obligationTemplateId: id,
        complianceStatus: 'active',
        criticality: obligation.basis_type === 'statutory' ? 'high' : 'medium',
        isDemo: true,
        seedKey: `bo:${obligation.seed_key}`,
        createdBy: 'seed:test-building',
      },
    });
  }

  const ppmTemplateId = sid('ppm_nt01_general', 'ppm');
  await prisma.ppmTemplate.create({
    data: {
      id: ppmTemplateId,
      tenantId,
      buildingId,
      name: 'NT01 General PPM Template',
      isDemo: true,
      seedKey: 'ppm_nt01_general',
      createdBy: 'seed:test-building',
    },
  });

  const roleCycle = ['vendor_user', 'chief_engineer', 'technician', 'cleaner'];
  for (let i = 0; i < obligations.length; i++) {
    const obligation = obligations[i];
    await prisma.ppmPlanItem.create({
      data: {
        id: sid(`ppi:${obligation.seed_key}`, 'ppi'),
        tenantId,
        buildingId,
        templateId: ppmTemplateId,
        obligationTemplateId: obligation.id,
        assignedRole: roleCycle[i % roleCycle.length],
        recurrenceRule: obligation.recurrence_rule,
        nextDueAt: new Date(Date.now() + (i + 1) * 2 * 24 * 60 * 60 * 1000),
        isDemo: true,
        seedKey: `ppi:${obligation.seed_key}`,
        createdBy: 'seed:test-building',
      },
    });
  }

  const ppmItems = await prisma.ppmPlanItem.findMany({ where: { tenantId, buildingId } });
  const obligationById = new Map(obligations.map((o) => [o.id, o]));
  const horizon = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const taskRows = [];

  for (const item of ppmItems) {
    const obligation = obligationById.get(item.obligationTemplateId);
    const parsed = parseRule(item.recurrenceRule);
    let cursor = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    while (cursor <= horizon) {
      cursor = addByRule(cursor, parsed);
      if (cursor > horizon) break;

      taskRows.push({
        id: sid(`${item.id}:${cursor.toISOString()}`, 'tsk'),
        tenantId,
        buildingId,
        planItemId: item.id,
        title: obligation?.name || 'PPM task',
        status: 'open',
        dueAt: new Date(cursor),
        recurrenceRule: item.recurrenceRule,
        evidenceRequired: obligation?.requires_evidence ?? true,
        evidenceDocuments: [],
        blockedReason: null,
        isDemo: true,
        seedKey: `${item.seedKey}:${cursor.toISOString().slice(0, 10)}`,
        createdBy: 'seed:test-building',
      });
    }
  }

  taskRows.sort((a, b) => a.dueAt - b.dueAt);
  taskRows.slice(0, 4).forEach((t, idx) => {
    t.status = 'overdue';
    t.dueAt = new Date(Date.now() - (idx + 4) * 24 * 60 * 60 * 1000);
  });
  taskRows.slice(4, 7).forEach((t) => {
    t.status = 'completed';
    t.evidenceDocuments = ['doc_legionella_lab'];
  });
  taskRows.slice(7, 9).forEach((t) => {
    t.status = 'blocked';
    t.blockedReason = 'missing_approval';
    t.title = 'AHU-02 VFD upgrade';
  });
  taskRows.slice(9, 11).forEach((t) => {
    t.status = 'blocked';
    t.blockedReason = 'missing_document';
    t.title = 'Fire doors inspection';
  });
  if (taskRows[0]) {
    taskRows[0].title = 'Fire pump monthly run test';
  }
  if (taskRows[12]) {
    taskRows[12].title = 'Passenger Lift A monthly preventive visit';
    taskRows[12].status = 'open';
    taskRows[12].dueAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  }
  if (taskRows[5]) {
    taskRows[5].title = 'Legionella sampling';
    taskRows[5].status = 'completed';
    taskRows[5].evidenceDocuments = ['doc_legionella_lab'];
  }

  for (const row of taskRows) {
    await prisma.taskInstance.create({ data: row });
  }

  const opexId = sid('bdg_nt01_opex_2026', 'bdg');
  const capexId = sid('bdg_nt01_capex_2026', 'bdg');

  await prisma.budget.create({
    data: {
      id: opexId,
      tenantId,
      buildingId,
      name: 'NT01 OPEX 2026',
      fiscalYear: 2026,
      currency: 'ILS',
      isDemo: true,
      seedKey: 'bdg_nt01_opex_2026',
      createdBy: 'seed:test-building',
    },
  });
  await prisma.budget.create({
    data: {
      id: capexId,
      tenantId,
      buildingId,
      name: 'NT01 CAPEX 2026',
      fiscalYear: 2026,
      currency: 'ILS',
      isDemo: true,
      seedKey: 'bdg_nt01_capex_2026',
      createdBy: 'seed:test-building',
    },
  });

  const budgetLines = [
    { key: 'bdgl_cleaning', budgetId: opexId, code: 'OPEX-CLEAN', name: 'Cleaning', amount: 180000 },
    { key: 'bdgl_maintenance', budgetId: opexId, code: 'OPEX-MAINT', name: 'Planned Maintenance', amount: 420000 },
    { key: 'bdgl_utilities', budgetId: opexId, code: 'OPEX-UTIL', name: 'Utilities', amount: 600000 },
    { key: 'bdgl_vfd_upgrade', budgetId: capexId, code: 'CAPEX-HVAC-01', name: 'AHU VFD Upgrade', amount: 85000 },
    { key: 'bdgl_access_upgrade', budgetId: capexId, code: 'CAPEX-SEC-01', name: 'Access Control Upgrade', amount: 120000 },
  ];

  for (const line of budgetLines) {
    await prisma.budgetLine.create({
      data: {
        id: sid(line.key, 'bgl'),
        budgetId: line.budgetId,
        code: line.code,
        name: line.name,
        amount: line.amount,
        isDemo: true,
        seedKey: line.key,
      },
    });
  }

  await prisma.invoice.create({
    data: {
      id: sid('inv_cleaning_apr_2026', 'inv'),
      tenantId,
      buildingId,
      budgetLineId: sid('bdgl_cleaning', 'bgl'),
      invoiceNo: 'NT01-APR-CLEAN-001',
      amount: 15000,
      status: 'approved',
      vendorName: 'Spark & Flow Services',
      isDemo: true,
      seedKey: 'inv_cleaning_apr_2026',
      createdBy: 'seed:test-building',
    },
  });
  await prisma.invoice.create({
    data: {
      id: sid('inv_fire_service_q1_2026', 'inv'),
      tenantId,
      buildingId,
      budgetLineId: sid('bdgl_maintenance', 'bgl'),
      invoiceNo: 'NT01-Q1-FIRE-001',
      amount: 22000,
      status: 'pending_payment',
      vendorName: 'Spark & Flow Services',
      isDemo: true,
      seedKey: 'inv_fire_service_q1_2026',
      createdBy: 'seed:test-building',
    },
  });

  const approvals = [
    {
      id: sid('apr_ahu_vfd_upgrade', 'apr'),
      seedKey: 'apr_ahu_vfd_upgrade',
      type: 'spend_approval',
      title: 'Replace AHU-02 VFD',
      amount: 68000,
      requester: 'Project Manager',
      threshold: '$50,000',
      hint: 'Approval required',
      steps: [
        { key: 'aps_ahu_l1', orderNo: 1, role: 'building_manager', status: 'approved' },
        { key: 'aps_ahu_l2', orderNo: 2, role: 'finance_controller', status: 'pending' },
        { key: 'aps_ahu_l3', orderNo: 3, role: 'owner_representative', status: 'pending' },
      ],
    },
    {
      id: sid('apr_doc_ppm_program', 'apr'),
      seedKey: 'apr_doc_ppm_program',
      type: 'document_approval',
      title: 'PPM Program Revision v2',
      amount: 0,
      requester: 'Document Controller',
      threshold: null,
      hint: null,
      steps: [
        { key: 'aps_doc_l1', orderNo: 1, role: 'chief_engineer', status: 'pending' },
        { key: 'aps_doc_l2', orderNo: 2, role: 'owner_representative', status: 'pending' },
      ],
    },
    {
      id: sid('apr_task_closeout_fire_pump', 'apr'),
      seedKey: 'apr_task_closeout_fire_pump',
      type: 'task_closeout_approval',
      title: 'Fire Pump Monthly Test Closeout',
      amount: 0,
      requester: 'Maintenance Technician',
      threshold: null,
      hint: 'Evidence required',
      steps: [
        { key: 'aps_task_l1', orderNo: 1, role: 'chief_engineer', status: 'pending' },
      ],
    },
  ];

  for (const approval of approvals) {
    await prisma.approvalRequest.create({
      data: {
        id: approval.id,
        tenantId,
        buildingId,
        title: approval.title,
        type: approval.type,
        amount: approval.amount,
        status: approval.steps.some((x) => x.status === 'pending') ? 'pending' : 'approved',
        requesterName: approval.requester,
        threshold: approval.threshold,
        hint: approval.hint,
        isDemo: true,
        seedKey: approval.seedKey,
        createdBy: 'seed:test-building',
      },
    });

    for (const step of approval.steps) {
      await prisma.approvalStep.create({
        data: {
          id: sid(step.key, 'aps'),
          requestId: approval.id,
          orderNo: step.orderNo,
          role: step.role,
          status: step.status,
          isDemo: true,
          seedKey: step.key,
        },
      });
    }
  }

  const docs = [
    { key: 'doc_takeover_checklist', type: 'handover_checklist', title: 'NT01 Handover Checklist', status: 'published', versionNo: 1 },
    { key: 'doc_fire_pump_cert', type: 'certificate', title: 'Fire Pump Annual Certificate', status: 'published', versionNo: 1 },
    { key: 'doc_generator_report', type: 'service_report', title: 'Generator Load Bank Report', status: 'published', versionNo: 1 },
    { key: 'doc_legionella_lab', type: 'lab_result', title: 'Legionella Q1 Lab Result', status: 'published', versionNo: 1 },
    { key: 'doc_budget_memo', type: 'approval_memo', title: 'AHU-02 VFD Upgrade Memo', status: 'in_review', versionNo: 2 },
    { key: 'doc_ppm_template', type: 'ppm_program', title: 'NT01 General PPM Program', status: 'published', versionNo: 1 },
  ];

  const prefix = process.env.DEMO_STORAGE_PREFIX || 'demo/northstone-demo';
  for (const doc of docs) {
    await prisma.document.create({
      data: {
        id: sid(doc.key, 'doc'),
        tenantId,
        buildingId,
        title: doc.title,
        documentType: doc.type,
        status: doc.status,
        versionNo: doc.versionNo,
        storageKey: `${prefix}/${doc.key}.pdf`,
        createdBy: 'seed:test-building',
        approvedBy: doc.status === 'published' ? 'owner_representative' : null,
        isDemo: true,
        seedKey: doc.key,
      },
    });
  }

  const events = [
    'seed.started',
    'workspace.created',
    'organizations.created',
    'building.created',
    'roles.assigned',
    'obligations.applied',
    'tasks.materialized',
    'document.published',
    'approval.requested',
    'approval.step.approved',
    'seed.completed',
  ];

  for (let i = 0; i < 20; i++) {
    await prisma.auditEntry.create({
      data: {
        id: sid(`aud_seed_${i}`, 'aud'),
        tenantId,
        buildingId,
        actor: i % 4 === 0 ? 'system' : 'seed:test-building',
        role: i % 4 === 0 ? 'worker' : 'seed',
        action: events[i % events.length],
        entity: manifest.building.name,
        entityType: 'system',
        building: manifest.building.name,
        ip: '127.0.0.1',
        sensitive: false,
        eventType: events[i % events.length],
        resourceType: 'seed',
        resourceId: buildingId,
        metadata: { index: i },
        isDemo: true,
        seedKey: `aud_seed_${i}`,
        createdBy: 'seed:test-building',
      },
    });
  }

  await prisma.seedRun.update({
    where: { seedName_seedVersion: { seedName, seedVersion } },
    data: {
      tenantId,
      status: 'completed',
      finishedAt: new Date(),
      errorText: null,
    },
  });

  console.log('[seed] completed');
  console.log(`[seed] workspace: ${manifest.workspace.slug}`);
  console.log(`[seed] building: ${manifest.building.slug}`);
  console.log(`[seed] organizations: ${manifest.organizations.length}`);
  console.log(`[seed] users: ${manifest.users.length}`);
  console.log(`[seed] assets: ${manifest.assets.length}`);
  console.log(`[seed] obligations: ${manifest.obligation_templates.length}`);
  console.log(`[seed] tasks: ${taskRows.length}`);
}

run()
  .catch(async (error) => {
    const seedName = process.env.DEMO_SEED_NAME || 'test-building';
    const seedVersion = process.env.DEMO_SEED_VERSION || '2026-04-18';
    try {
      await prisma.seedRun.upsert({
        where: { seedName_seedVersion: { seedName, seedVersion } },
        create: {
          seedName,
          seedVersion,
          status: 'failed',
          checksum: 'failed',
          startedAt: new Date(),
          finishedAt: new Date(),
          errorText: error instanceof Error ? error.message : String(error),
          createdBy: 'seed:test-building',
        },
        update: {
          status: 'failed',
          finishedAt: new Date(),
          errorText: error instanceof Error ? error.message : String(error),
        },
      });
    } catch (_) {
      // noop
    }

    console.error('[seed] failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
