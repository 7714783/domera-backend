// INIT-007 Phase 4 — TenantCompany module skeleton.
//
// Thin wrapper on BuildingOccupantCompany that surfaces the tenant/company
// relation for RBAC purposes. When BuildingOccupantCompany.adminUserId is
// populated, the linked User gets TENANT_COMPANY_ADMIN role with scope
// tenantCompanyId = occupantCompany.id via a BuildingRoleAssignment row.
//
// This file is deliberately thin — the underlying data model already lives
// in building-core for leasing purposes. What's new here is the admin-user
// wiring + the role-grant creation when promoting a user to
// TENANT_COMPANY_ADMIN.

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TenantCompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, buildingId: string) {
    const items = await this.prisma.buildingOccupantCompany.findMany({
      where: { tenantId, buildingId },
      orderBy: { companyName: 'asc' },
      include: {
        occupancies: {
          where: { occupancyStatus: 'active' },
          select: { unitId: true },
        },
      },
    });
    return {
      total: items.length,
      items: items.map((c) => ({
        id: c.id,
        companyName: c.companyName,
        contactName: c.contactName,
        phone: c.phone,
        email: c.email,
        adminUserId: c.adminUserId,
        activeUnitCount: c.occupancies.length,
      })),
    };
  }

  async get(tenantId: string, id: string) {
    const c = await this.prisma.buildingOccupantCompany.findFirst({
      where: { id, tenantId },
      include: {
        occupancies: { include: { unit: { select: { unitCode: true } } } },
        contracts: { select: { id: true, contractType: true, status: true } },
        settings: true,
      },
    });
    if (!c) throw new NotFoundException('tenant company not found');
    return c;
  }

  /** Link a User to this occupant company as its admin. Creates a
   *  BuildingRoleAssignment(role=tenant_company_admin) scoped by
   *  tenantCompanyId so the policy engine narrows all "my company" queries
   *  for that user. Role key must exist — seed Phase 4 is responsible for
   *  creating it.
   *
   *  Idempotent: if the user is already linked the operation is a no-op. */
  async setAdmin(
    tenantId: string,
    actorUserId: string,
    occupantCompanyId: string,
    body: { userId: string | null },
  ) {
    if (!actorUserId) throw new UnauthorizedException();
    if (body.userId === undefined)
      throw new BadRequestException('userId required (null to unlink)');

    const company = await this.prisma.buildingOccupantCompany.findFirst({
      where: { id: occupantCompanyId, tenantId },
    });
    if (!company) throw new NotFoundException('tenant company not found');

    // Ensure the role exists before we try to grant it. Seed runs idempotent
    // upsert for 'tenant_company_admin' — if it's missing just fail cleanly.
    const role = await this.prisma.role.findUnique({
      where: { key: 'tenant_company_admin' },
    });
    if (!role) {
      throw new BadRequestException(
        'Role tenant_company_admin not in DB — run seed-reference.mjs (INIT-007 Phase 4)',
      );
    }

    const prevAdminUserId = company.adminUserId;

    // Update the FK on the company row.
    await this.prisma.buildingOccupantCompany.update({
      where: { id: company.id },
      data: { adminUserId: body.userId },
    });

    // Revoke prior grant if there was one.
    if (prevAdminUserId && prevAdminUserId !== body.userId) {
      await this.prisma.buildingRoleAssignment.deleteMany({
        where: {
          tenantId,
          buildingId: company.buildingId,
          userId: prevAdminUserId,
          roleKey: 'tenant_company_admin',
          tenantCompanyId: company.id,
        },
      });
    }

    // Create the new grant.
    if (body.userId) {
      await this.prisma.buildingRoleAssignment.upsert({
        where: {
          buildingId_userId_roleKey: {
            buildingId: company.buildingId,
            userId: body.userId,
            roleKey: 'tenant_company_admin',
          },
        },
        create: {
          tenantId,
          buildingId: company.buildingId,
          userId: body.userId,
          roleKey: 'tenant_company_admin',
          tenantCompanyId: company.id,
          delegatedBy: actorUserId,
        },
        update: {
          tenantCompanyId: company.id,
          delegatedBy: actorUserId,
          delegatedAt: new Date(),
        },
      });
    }

    await this.audit.write({
      tenantId,
      buildingId: company.buildingId,
      actor: actorUserId,
      role: 'delegator',
      action: body.userId ? 'TenantCompany admin set' : 'TenantCompany admin unset',
      entity: company.id,
      entityType: 'tenant_company',
      building: company.buildingId,
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'tenant_company.admin_changed',
      resourceType: 'tenant_company',
      resourceId: company.id,
      metadata: { before: prevAdminUserId, after: body.userId },
    });

    return { ok: true, occupantCompanyId: company.id, adminUserId: body.userId };
  }
}
