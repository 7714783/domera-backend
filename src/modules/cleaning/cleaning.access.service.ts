import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CleaningActor } from './cleaning.access';

/**
 * Resolves the acting user into a CleaningActor scope. First match wins:
 *   1. platform_admin (isSuperAdmin)
 *   2. workspace_owner/admin → operations_manager-equivalent
 *   3. building_manager / operations_manager via BuildingRoleAssignment
 *   4. CleaningStaff row linked by userId → role code maps to module role
 */
@Injectable()
export class CleaningAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: string, userId: string): Promise<CleaningActor> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isSuperAdmin: true },
    });
    if (!user) throw new UnauthorizedException('user not found');
    if (user.isSuperAdmin) return { kind: 'platform_admin', userId, tenantId };

    const ws = await this.prisma.membership.findFirst({
      where: {
        tenantId,
        userId,
        roleKey: { in: ['workspace_owner', 'workspace_admin', 'org_admin'] },
      },
    });
    if (ws) {
      const buildings = await this.prisma.building.findMany({
        where: { tenantId },
        select: { id: true },
      });
      return {
        kind: 'operations_manager',
        userId,
        tenantId,
        buildingIds: buildings.map((b) => b.id),
      };
    }

    const bmRoles = await this.prisma.buildingRoleAssignment.findMany({
      where: {
        tenantId,
        userId,
        roleKey: { in: ['building_manager', 'operations_manager', 'chief_engineer'] },
      },
      select: { buildingId: true },
    });
    if (bmRoles.length > 0) {
      return {
        kind: 'building_manager',
        userId,
        tenantId,
        buildingIds: bmRoles.map((r) => r.buildingId),
      };
    }

    const staff = await this.prisma.cleaningStaff.findFirst({
      where: { tenantId, userId, isActive: true },
    });
    if (!staff) throw new ForbiddenException('no cleaning access');

    const role = await this.prisma.cleaningRole.findUnique({ where: { id: staff.roleId } });
    const contractor = await this.prisma.cleaningContractor.findUnique({
      where: { id: staff.contractorId },
    });
    if (!role || !contractor) throw new ForbiddenException('cleaning role/contractor missing');

    switch (role.code) {
      case 'boss':
        return {
          kind: 'cleaning_boss',
          userId,
          tenantId,
          contractorIds: [contractor.id],
          buildingId: contractor.buildingId,
        };
      case 'manager':
        return {
          kind: 'cleaning_manager',
          userId,
          tenantId,
          contractorIds: [contractor.id],
          buildingId: contractor.buildingId,
        };
      case 'supervisor': {
        const zones = await this.prisma.cleaningZone.findMany({
          where: { tenantId, supervisorStaffId: staff.id, isActive: true },
          select: { id: true },
        });
        return {
          kind: 'cleaning_supervisor',
          userId,
          tenantId,
          staffId: staff.id,
          contractorId: contractor.id,
          zoneIds: zones.map((z) => z.id),
        };
      }
      case 'cleaner':
      case 'dispatcher':
      default:
        return {
          kind: 'cleaner',
          userId,
          tenantId,
          staffId: staff.id,
          contractorId: contractor.id,
        };
    }
  }
}
