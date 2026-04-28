import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CleaningActor, assertInScope } from './cleaning.access';

const VALID_ROLES = ['boss', 'manager', 'supervisor', 'cleaner', 'dispatcher'];
const VALID_ZONE_TYPES = ['floor', 'wc', 'office', 'lobby', 'corridor', 'shared_area', 'custom'];
const ROLE_NAMES: Record<string, string> = {
  boss: 'Cleaning Boss',
  manager: 'Cleaning Manager',
  supervisor: 'Cleaning Supervisor',
  cleaner: 'Cleaner',
  dispatcher: 'Cleaning Dispatcher',
};

function requireManagerActor(actor: CleaningActor) {
  if (
    ![
      'platform_admin',
      'operations_manager',
      'building_manager',
      'cleaning_boss',
      'cleaning_manager',
    ].includes(actor.kind)
  ) {
    throw new ForbiddenException('requires manager role');
  }
}

@Injectable()
export class CleaningAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Contractors ────────────────────────────────────────
  async listContractors(actor: CleaningActor, buildingId?: string) {
    const where: any = { tenantId: actor.tenantId };
    if (buildingId) where.buildingId = buildingId;
    if (actor.kind === 'cleaning_boss' || actor.kind === 'cleaning_manager') {
      where.id = { in: (actor as any).contractorIds };
    }
    if (actor.kind === 'cleaning_supervisor' || actor.kind === 'cleaner') {
      where.id = (actor as any).contractorId;
    }
    return this.prisma.cleaningContractor.findMany({ where, orderBy: { name: 'asc' } });
  }

  async createContractor(
    actor: CleaningActor,
    body: {
      buildingId: string;
      name: string;
      legalName?: string;
      phone?: string;
      email?: string;
      notes?: string;
    },
  ) {
    requireManagerActor(actor);
    assertInScope(actor, { buildingId: body.buildingId });
    if (!body.name || !body.buildingId)
      throw new BadRequestException('name and buildingId required');
    const contractor = await this.prisma.cleaningContractor.create({
      data: {
        tenantId: actor.tenantId,
        buildingId: body.buildingId,
        name: body.name,
        legalName: body.legalName || null,
        phone: body.phone || null,
        email: body.email || null,
        notes: body.notes || null,
      },
    });
    // Seed default role set for the contractor.
    for (const code of VALID_ROLES) {
      await this.prisma.cleaningRole.create({
        data: {
          tenantId: actor.tenantId,
          contractorId: contractor.id,
          code,
          name: ROLE_NAMES[code],
        },
      });
    }
    return contractor;
  }

  // ── Staff ───────────────────────────────────────────────
  async listStaff(actor: CleaningActor, contractorId: string) {
    assertInScope(actor, { contractorId });
    return this.prisma.cleaningStaff.findMany({
      where: { tenantId: actor.tenantId, contractorId },
      orderBy: { fullName: 'asc' },
    });
  }

  async createStaff(
    actor: CleaningActor,
    body: {
      contractorId: string;
      fullName: string;
      phone?: string;
      email?: string;
      roleCode: string;
      managerId?: string;
      userId?: string;
    },
  ) {
    requireManagerActor(actor);
    assertInScope(actor, { contractorId: body.contractorId });
    if (!body.fullName || !body.roleCode)
      throw new BadRequestException('fullName and roleCode required');
    if (!VALID_ROLES.includes(body.roleCode))
      throw new BadRequestException(`roleCode must be ${VALID_ROLES.join(', ')}`);
    const role = await this.prisma.cleaningRole.findUnique({
      where: { contractorId_code: { contractorId: body.contractorId, code: body.roleCode } },
    });
    if (!role) throw new NotFoundException(`role ${body.roleCode} not found for contractor`);
    if (body.managerId) {
      const mgr = await this.prisma.cleaningStaff.findFirst({
        where: { id: body.managerId, contractorId: body.contractorId },
      });
      if (!mgr) throw new NotFoundException('managerId not found in this contractor');
    }
    return this.prisma.cleaningStaff.create({
      data: {
        tenantId: actor.tenantId,
        contractorId: body.contractorId,
        fullName: body.fullName,
        phone: body.phone || null,
        email: body.email || null,
        roleId: role.id,
        managerId: body.managerId || null,
        userId: body.userId || null,
      },
    });
  }

  // ── Zones ───────────────────────────────────────────────
  async listZones(actor: CleaningActor, buildingId?: string) {
    const where: any = { tenantId: actor.tenantId };
    if (buildingId) where.buildingId = buildingId;
    if (actor.kind === 'cleaning_supervisor') where.id = { in: (actor as any).zoneIds };
    if (actor.kind === 'cleaning_boss' || actor.kind === 'cleaning_manager') {
      where.OR = [{ contractorId: { in: (actor as any).contractorIds } }, { contractorId: null }];
    }
    return this.prisma.cleaningZone.findMany({ where, orderBy: [{ code: 'asc' }] });
  }

  async createZone(
    actor: CleaningActor,
    body: {
      buildingId: string;
      name: string;
      code: string;
      zoneType: string;
      floorId?: string;
      locationId?: string;
      contractorId?: string;
      supervisorStaffId?: string;
    },
  ) {
    requireManagerActor(actor);
    assertInScope(actor, { buildingId: body.buildingId, contractorId: body.contractorId });
    if (!body.name || !body.code || !body.zoneType)
      throw new BadRequestException('name, code, zoneType required');
    if (!VALID_ZONE_TYPES.includes(body.zoneType))
      throw new BadRequestException(`zoneType must be ${VALID_ZONE_TYPES.join(', ')}`);
    if (body.contractorId) {
      const c = await this.prisma.cleaningContractor.findFirst({
        where: { id: body.contractorId, tenantId: actor.tenantId, buildingId: body.buildingId },
      });
      if (!c) throw new NotFoundException('contractor not in this building');
    }
    return this.prisma.cleaningZone.create({
      data: {
        tenantId: actor.tenantId,
        buildingId: body.buildingId,
        floorId: body.floorId || null,
        locationId: body.locationId || null,
        name: body.name,
        code: body.code,
        zoneType: body.zoneType,
        contractorId: body.contractorId || null,
        supervisorStaffId: body.supervisorStaffId || null,
      },
    });
  }

  async assignZone(
    actor: CleaningActor,
    zoneId: string,
    body: { contractorId?: string | null; supervisorStaffId?: string | null },
  ) {
    requireManagerActor(actor);
    const zone = await this.prisma.cleaningZone.findFirst({
      where: { id: zoneId, tenantId: actor.tenantId },
    });
    if (!zone) throw new NotFoundException('zone not found');
    assertInScope(actor, {
      buildingId: zone.buildingId,
      contractorId: body.contractorId ?? zone.contractorId,
    });
    return this.prisma.cleaningZone.update({
      where: { id: zoneId },
      data: {
        contractorId: body.contractorId === undefined ? undefined : body.contractorId,
        supervisorStaffId:
          body.supervisorStaffId === undefined ? undefined : body.supervisorStaffId,
      },
    });
  }
}
