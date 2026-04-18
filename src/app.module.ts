import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { BuildingsModule } from './modules/buildings/buildings.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { AuditModule } from './modules/audit/audit.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { SeedRuntimeModule } from './modules/seed-runtime/seed-runtime.module';
import { ImportsModule } from './modules/imports/imports.module';
import { ObligationsModule } from './modules/obligations/obligations.module';
import { IamModule } from './modules/iam/iam.module';
import { TakeoverModule } from './modules/takeover/takeover.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { BuildingCoreModule } from './modules/building-core/building-core.module';
import { PpmModule } from './modules/ppm/ppm.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    TenancyModule,
    AuthModule,
    AuditModule,
    OrganizationsModule,
    ApprovalsModule,
    BuildingsModule,
    ComplianceModule,
    SeedRuntimeModule,
    ImportsModule,
    ObligationsModule,
    IamModule,
    TakeoverModule,
    OnboardingModule,
    BuildingCoreModule,
    PpmModule,
  ],
})
export class AppModule {}
