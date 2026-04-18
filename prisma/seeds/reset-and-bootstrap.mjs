import * as bcryptModule from 'bcryptjs';
const bcrypt = bcryptModule.default || bcryptModule;
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FIRST_USERNAME = 'Menivim';
const FIRST_PASSWORD = 'Kozaa@326914017';
const FIRST_EMAIL = 'menivim@domera.local';

async function wipe() {
  await prisma.$transaction([
    prisma.importJobRow.deleteMany({}),
    prisma.importJob.deleteMany({}),
    prisma.takeoverCase.deleteMany({}),
    prisma.workOrder.deleteMany({}),
    prisma.project.deleteMany({}),
    prisma.engineeringRecommendation.deleteMany({}),
    prisma.auditEntry.deleteMany({}),
    prisma.document.deleteMany({}),
    prisma.approvalStep.deleteMany({}),
    prisma.approvalRequest.deleteMany({}),
    prisma.invoice.deleteMany({}),
    prisma.budgetLine.deleteMany({}),
    prisma.budget.deleteMany({}),
    prisma.taskInstance.deleteMany({}),
    prisma.ppmPlanItem.deleteMany({}),
    prisma.ppmTemplate.deleteMany({}),
    prisma.buildingObligation.deleteMany({}),
    prisma.applicabilityRule.deleteMany({}),
    prisma.obligationBasis.deleteMany({}),
    prisma.obligationTemplate.deleteMany({}),
    prisma.asset.deleteMany({}),
    prisma.buildingRoleAssignment.deleteMany({}),
    prisma.buildingMandate.deleteMany({}),
    prisma.building.deleteMany({}),
    prisma.organizationMembership.deleteMany({}),
    prisma.organization.deleteMany({}),
    prisma.membership.deleteMany({}),
    prisma.userCertification.deleteMany({}),
    prisma.user.deleteMany({}),
    prisma.tenant.deleteMany({}),
    prisma.seedRun.deleteMany({}),
  ]);
}

async function bootstrap() {
  const existing = await prisma.user.findUnique({ where: { username: FIRST_USERNAME } });
  if (existing) {
    console.log('[bootstrap] user already exists:', existing.id);
    return existing;
  }
  const passwordHash = await bcrypt.hash(FIRST_PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      email: FIRST_EMAIL,
      emailNormalized: FIRST_EMAIL,
      username: FIRST_USERNAME,
      passwordHash,
      displayName: FIRST_USERNAME,
      isSuperAdmin: true,
      status: 'active',
      createdBy: 'bootstrap',
    },
  });
  console.log(`[bootstrap] created superadmin: ${user.username} (${user.id})`);
  return user;
}

async function run() {
  console.log('[reset] wiping all data...');
  await wipe();
  console.log('[reset] done');
  await bootstrap();
}

run()
  .catch((err) => { console.error('[reset] failed', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
