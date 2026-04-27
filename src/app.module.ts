import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { TenantMiddleware } from './common/tenant.middleware';
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
import { QrLocationsModule } from './modules/qr-locations/qr-locations.module';
import { PublicQrModule } from './modules/public-qr/public-qr.module';
import { ReactiveModule } from './modules/reactive/reactive.module';
import { ComplianceProfilesModule } from './modules/compliance-profiles/compliance-profiles.module';
import { RoleDashboardsModule } from './modules/role-dashboards/role-dashboards.module';
import { DocumentLinksModule } from './modules/document-links/document-links.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { VendorInvoicesModule } from './modules/vendor-invoices/vendor-invoices.module';
import { EmergencyOverridesModule } from './modules/emergency-overrides/emergency-overrides.module';
import { CalendarBlackoutsModule } from './modules/calendar-blackouts/calendar-blackouts.module';
import { ConditionTriggersModule } from './modules/condition-triggers/condition-triggers.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { LeasesModule } from './modules/leases/leases.module';
import { EventsModule } from './modules/events/events.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { MfaModule } from './modules/mfa/mfa.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { MetricsMiddleware } from './modules/metrics/metrics.middleware';
import { SsoModule } from './modules/sso/sso.module';
import { ScimModule } from './modules/scim/scim.module';
import { ConnectorsModule } from './modules/connectors/connectors.module';
import { CleaningModule } from './modules/cleaning/cleaning.module';
import { DocumentTemplatesModule } from './modules/document-templates/document-templates.module';
import { RoundsModule } from './modules/rounds/rounds.module';
import { AssetsModule } from './modules/assets/assets.module';
import { OccupantsModule } from './modules/occupants/occupants.module';
import { DevicesModule } from './modules/devices/devices.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TenantCompaniesModule } from './modules/tenant-companies/tenant-companies.module';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { ContractorCompaniesModule } from './modules/contractor-companies/contractor-companies.module';
// INIT-013 Roles & Team module
import { ContractorsPublicModule } from './modules/contractors-public/contractors-public.module';
import { ContractorsWorkspaceModule } from './modules/contractors-workspace/contractors-workspace.module';
import { TeamModule } from './modules/team/team.module';
import { RolesModule } from './modules/roles/roles.module';
import { RoleAssignmentsModule } from './modules/role-assignments/role-assignments.module';

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
    QrLocationsModule,
    PublicQrModule,
    ReactiveModule,
    ComplianceProfilesModule,
    RoleDashboardsModule,
    DocumentLinksModule,
    InventoryModule,
    DocumentsModule,
    VendorInvoicesModule,
    EmergencyOverridesModule,
    CalendarBlackoutsModule,
    ConditionTriggersModule,
    ProjectsModule,
    LeasesModule,
    EventsModule,
    WebhooksModule,
    PrivacyModule,
    MfaModule,
    MetricsModule,
    SsoModule,
    ScimModule,
    ConnectorsModule,
    CleaningModule,
    DocumentTemplatesModule,
    RoundsModule,
    AssetsModule,
    OccupantsModule,
    DevicesModule,
    TasksModule,
    TenantCompaniesModule,
    AssignmentModule,
    ContractorCompaniesModule,
    ContractorsPublicModule,
    ContractorsWorkspaceModule,
    TeamModule,
    RolesModule,
    RoleAssignmentsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes('*');
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
