// GROWTH-001 NS-23 — operational tooling for tenant emergencies.
//
// Two endpoints:
//   1. POST /v1/admin/tenants/:id/suspend   — flip Tenant.status='suspended'
//   2. POST /v1/admin/tenants/:id/reactivate — flip back to 'active'
//   3. GET  /v1/admin/tenants/:id/export    — full-tenant JSON dump
//
// All three are owner-gated:
//   - actor must hold a Membership with roleKey='workspace_owner' in
//     the target tenant, OR be a superadmin (User.isSuperAdmin=true).
//   - confirmText (body) must equal Tenant.slug verbatim — same
//     two-factor pattern used by buildings.deleteBuilding so the
//     operator cannot fat-finger a kill-switch.
//
// When Tenant.status='suspended', TenantMiddleware refuses every
// non-GET request to that tenant. The reactivate endpoint itself
// short-circuits the suspended check (it's the escape hatch).
//
// Emergency export is JSON-only for v1 — every entity owned by the
// tenant is dumped into one document. Audit-write fires on every
// export so the trail records "operator X exported tenant Y at T".

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MigratorPrismaService } from '../../prisma/prisma.migrator';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TenancyService {
  constructor(
    private readonly migrator: MigratorPrismaService,
    private readonly audit: AuditService,
  ) {}

  // Owner gate: require workspace_owner membership in the target tenant
  // OR a superadmin user. Reused by every method below.
  private async assertOwnerOrSuperadmin(actorUserId: string, tenantId: string): Promise<void> {
    const user = await this.migrator.user.findUnique({
      where: { id: actorUserId },
      select: { isSuperAdmin: true },
    });
    if (user?.isSuperAdmin) return;
    const m = await this.migrator.membership.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: 'workspace_owner', status: 'active' },
      select: { id: true },
    });
    if (!m) throw new ForbiddenException('workspace_owner membership required');
  }

  // Two-factor lock: the actor MUST type the tenant slug verbatim. This
  // catches "I clicked the wrong tenant in the dropdown" mistakes which
  // are the dominant fail mode for an emergency-only endpoint that runs
  // ~once a year.
  private async resolveTenantOrThrow(tenantId: string, confirmText: string | undefined) {
    const tenant = await this.migrator.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('tenant not found');
    if (!confirmText || confirmText.trim() !== tenant.slug) {
      throw new BadRequestException(`confirmText must equal tenant slug "${tenant.slug}" verbatim`);
    }
    return tenant;
  }

  async suspend(
    actorUserId: string,
    tenantId: string,
    body: { confirmText?: string; reason?: string },
  ) {
    await this.assertOwnerOrSuperadmin(actorUserId, tenantId);
    const tenant = await this.resolveTenantOrThrow(tenantId, body.confirmText);
    if (tenant.status === 'suspended') {
      return { id: tenant.id, slug: tenant.slug, status: tenant.status };
    }
    const updated = await this.migrator.tenant.update({
      where: { id: tenantId },
      data: { status: 'suspended' },
      select: { id: true, slug: true, status: true },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'workspace_owner',
      action: 'tenant.suspended',
      entity: tenantId,
      entityType: 'tenant',
      building: '',
      ip: '',
      sensitive: true,
      eventType: 'tenant.suspended',
      metadata: { reason: body.reason || null, slug: tenant.slug },
    });
    return updated;
  }

  async reactivate(
    actorUserId: string,
    tenantId: string,
    body: { confirmText?: string; reason?: string },
  ) {
    await this.assertOwnerOrSuperadmin(actorUserId, tenantId);
    const tenant = await this.resolveTenantOrThrow(tenantId, body.confirmText);
    if (tenant.status === 'active') {
      return { id: tenant.id, slug: tenant.slug, status: tenant.status };
    }
    const updated = await this.migrator.tenant.update({
      where: { id: tenantId },
      data: { status: 'active' },
      select: { id: true, slug: true, status: true },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'workspace_owner',
      action: 'tenant.reactivated',
      entity: tenantId,
      entityType: 'tenant',
      building: '',
      ip: '',
      sensitive: true,
      eventType: 'tenant.reactivated',
      metadata: { reason: body.reason || null, slug: tenant.slug },
    });
    return updated;
  }

  // Emergency JSON export. Owner-gated + slug confirmation.
  // Returns one big object; the controller streams it as
  // application/json with Content-Disposition=attachment.
  async exportFull(actorUserId: string, tenantId: string, body: { confirmText?: string }) {
    await this.assertOwnerOrSuperadmin(actorUserId, tenantId);
    const tenant = await this.resolveTenantOrThrow(tenantId, body.confirmText);

    // Use the migrator client (BYPASSRLS) so we capture rows even when
    // RLS would otherwise hide them — this IS the escape hatch for a
    // bad RLS policy. Every where clause still scopes by tenantId so
    // we never bleed cross-tenant data.
    const m = this.migrator;
    const tenantScoped = { tenantId };

    const dump: Record<string, any> = {};

    dump.tenant = tenant;
    dump.exportedAt = new Date().toISOString();
    dump.exportedBy = actorUserId;

    // Core identity + access
    dump.users = await m.user.findMany({
      where: { memberships: { some: tenantScoped } },
    });
    dump.memberships = await m.membership.findMany({ where: tenantScoped });
    dump.organizations = await m.organization.findMany({ where: tenantScoped });
    // OrganizationMembership has no tenantId column — scope via parent.
    dump.organizationMemberships = await m.organizationMembership.findMany({
      where: { organization: { tenantId } },
    });
    dump.buildingRoleAssignments = await m.buildingRoleAssignment.findMany({
      where: tenantScoped,
    });

    // Buildings + structure
    dump.buildings = await m.building.findMany({ where: tenantScoped });
    dump.buildingFloors = await m.buildingFloor.findMany({ where: tenantScoped });
    dump.buildingUnits = await m.buildingUnit.findMany({ where: tenantScoped });
    dump.buildingSystems = await m.buildingSystem.findMany({ where: tenantScoped });
    dump.buildingVerticalTransports = await m.buildingVerticalTransport.findMany({
      where: tenantScoped,
    });
    dump.buildingSpaces = await m.buildingSpace.findMany({ where: tenantScoped });
    dump.buildingElements = await m.buildingElement.findMany({ where: tenantScoped });
    dump.buildingOccupantCompanies = await m.buildingOccupantCompany.findMany({
      where: tenantScoped,
    });
    dump.buildingContracts = await m.buildingContract.findMany({ where: tenantScoped });
    dump.buildingLocations = await m.buildingLocation.findMany({ where: tenantScoped });

    // Assets + maintenance
    dump.assets = await m.asset.findMany({ where: tenantScoped });
    dump.assetMedia = await m.assetMedia.findMany({ where: tenantScoped });
    dump.assetDocuments = await m.assetDocument.findMany({ where: tenantScoped });
    dump.ppmTemplates = await m.ppmTemplate.findMany({ where: tenantScoped });
    dump.ppmPlanItems = await m.ppmPlanItem.findMany({ where: tenantScoped });
    dump.taskInstances = await m.taskInstance.findMany({ where: tenantScoped });
    dump.taskNotes = await m.taskNote.findMany({ where: tenantScoped });

    // Reactive + cleaning
    dump.incidents = await m.incident.findMany({ where: tenantScoped });
    dump.serviceRequests = await m.serviceRequest.findMany({ where: tenantScoped });
    dump.workOrders = await m.workOrder.findMany({ where: tenantScoped });
    dump.completionRecords = await m.completionRecord.findMany({ where: tenantScoped });
    dump.cleaningRequests = await m.cleaningRequest.findMany({ where: tenantScoped });

    // Approvals + finance
    dump.approvalRequests = await m.approvalRequest.findMany({ where: tenantScoped });
    // ApprovalStep scoped via parent ApprovalRequest.
    dump.approvalSteps = await m.approvalStep.findMany({
      where: { request: { tenantId } },
    });
    dump.invoices = await m.invoice.findMany({ where: tenantScoped });
    dump.vendorInvoices = await m.vendorInvoice.findMany({ where: tenantScoped });
    dump.budgets = await m.budget.findMany({ where: tenantScoped });

    // Documents + audit
    dump.documents = await m.document.findMany({ where: tenantScoped });
    dump.documentLinks = await m.documentLink.findMany({ where: tenantScoped });
    dump.auditEntries = await m.auditEntry.findMany({
      where: tenantScoped,
      orderBy: { timestamp: 'desc' },
      take: 10000, // hard cap — audit can be enormous
    });

    // Invites + notifications
    dump.invites = await m.invite.findMany({ where: tenantScoped });
    dump.notificationDeliveries = await m.notificationDelivery.findMany({
      where: tenantScoped,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'workspace_owner',
      action: 'tenant.exported',
      entity: tenantId,
      entityType: 'tenant',
      building: '',
      ip: '',
      sensitive: true,
      eventType: 'tenant.exported',
      metadata: {
        slug: tenant.slug,
        rowCount: Object.entries(dump)
          .filter(([_, v]) => Array.isArray(v))
          .reduce((acc, [_, v]) => acc + (v as any[]).length, 0),
      },
    });

    return dump;
  }
}
