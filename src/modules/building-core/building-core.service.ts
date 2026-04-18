import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BuildingCoreService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireManager(tenantId: string, actorUserId: string) {
    const ws = await this.prisma.membership.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: { in: ['workspace_owner', 'workspace_admin', 'org_admin'] } },
    });
    if (ws) return;
    const br = await this.prisma.buildingRoleAssignment.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: { in: ['building_manager', 'chief_engineer'] } },
    });
    if (!br) throw new ForbiddenException('not authorized');
  }

  private async resolveBuildingId(tenantId: string, idOrSlug: string): Promise<string> {
    const byId = await this.prisma.building.findFirst({ where: { id: idOrSlug, tenantId }, select: { id: true } });
    if (byId) return byId.id;
    const bySlug = await this.prisma.building.findUnique({ where: { tenantId_slug: { tenantId, slug: idOrSlug } }, select: { id: true } });
    if (!bySlug) throw new NotFoundException('building not found');
    return bySlug.id;
  }

  // ── Floors ───────────────────────────────────────────
  async listFloors(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingFloor.findMany({
      where: { tenantId, buildingId },
      orderBy: { floorNumber: 'asc' },
    });
  }

  async createFloor(tenantId: string, actorUserId: string, buildingIdOrSlug: string, body: {
    floorCode: string; floorNumber: number; floorType: string; label?: string; grossAreaSqm?: number; isActive?: boolean; notes?: string;
  }) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.floorCode || body.floorNumber === undefined || !body.floorType) {
      throw new BadRequestException('floorCode, floorNumber, floorType required');
    }
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingFloor.create({
      data: {
        tenantId, buildingId,
        floorCode: body.floorCode,
        floorNumber: body.floorNumber,
        floorType: body.floorType,
        label: body.label || null,
        grossAreaSqm: body.grossAreaSqm ?? null,
        isActive: body.isActive ?? true,
        notes: body.notes || null,
      },
    });
  }

  // ── Units ────────────────────────────────────────────
  async listUnits(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingUnit.findMany({
      where: { tenantId, buildingId },
      include: { floor: { select: { floorCode: true, floorNumber: true } } },
      orderBy: [{ floor: { floorNumber: 'asc' } }, { unitCode: 'asc' }],
    });
  }

  async createUnit(tenantId: string, actorUserId: string, buildingIdOrSlug: string, body: {
    floorId: string; unitCode: string; unitType: string; areaSqm?: number; layoutZone?: string; isDivisible?: boolean; status?: string; notes?: string;
  }) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.floorId || !body.unitCode || !body.unitType) throw new BadRequestException('floorId, unitCode, unitType required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const floor = await this.prisma.buildingFloor.findFirst({ where: { id: body.floorId, buildingId } });
    if (!floor) throw new BadRequestException('floor not found in this building');

    return this.prisma.buildingUnit.create({
      data: {
        tenantId, buildingId, floorId: body.floorId,
        unitCode: body.unitCode,
        unitType: body.unitType,
        areaSqm: body.areaSqm ?? null,
        layoutZone: body.layoutZone || null,
        isDivisible: body.isDivisible ?? false,
        status: body.status || 'vacant',
        notes: body.notes || null,
      },
    });
  }

  async updateUnit(tenantId: string, actorUserId: string, buildingIdOrSlug: string, unitId: string, patch: {
    unitCode?: string; unitType?: string; areaSqm?: number | null; layoutZone?: string | null; isDivisible?: boolean; status?: string; notes?: string | null;
  }) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const existing = await this.prisma.buildingUnit.findFirst({ where: { id: unitId, buildingId, tenantId } });
    if (!existing) throw new NotFoundException('unit not found');
    return this.prisma.buildingUnit.update({ where: { id: existing.id }, data: patch as any });
  }

  // ── Vertical transport ───────────────────────────────
  async listTransport(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingVerticalTransport.findMany({
      where: { tenantId, buildingId },
      orderBy: { code: 'asc' },
    });
  }

  async createTransport(tenantId: string, actorUserId: string, buildingIdOrSlug: string, body: {
    code: string; transportType: string; servesFromFloor: number; servesToFloor: number; quantity?: number; status?: string; notes?: string;
  }) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.code || !body.transportType || body.servesFromFloor === undefined || body.servesToFloor === undefined) {
      throw new BadRequestException('code, transportType, servesFromFloor, servesToFloor required');
    }
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    const minFloor = -(building?.floorsBelowGround ?? 10);
    const maxFloor = (building?.floorsAboveGround ?? 50);
    if (body.servesFromFloor < minFloor - 2 || body.servesToFloor > maxFloor + 2) {
      throw new BadRequestException(`serves range out of building bounds (${minFloor}..${maxFloor})`);
    }
    return this.prisma.buildingVerticalTransport.create({
      data: {
        tenantId, buildingId,
        code: body.code,
        transportType: body.transportType,
        servesFromFloor: body.servesFromFloor,
        servesToFloor: body.servesToFloor,
        quantity: body.quantity ?? 1,
        status: body.status || 'active',
        notes: body.notes || null,
      },
    });
  }

  // ── Systems ──────────────────────────────────────────
  async listSystems(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingSystem.findMany({
      where: { tenantId, buildingId },
      include: { floor: { select: { floorCode: true, floorNumber: true } } },
      orderBy: [{ systemCategory: 'asc' }, { systemCode: 'asc' }],
    });
  }

  async createSystem(tenantId: string, actorUserId: string, buildingIdOrSlug: string, body: {
    systemCategory: string; systemCode: string; name: string; locationType?: string; floorId?: string; quantity?: number; status?: string; notes?: string;
  }) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.systemCategory || !body.systemCode || !body.name) throw new BadRequestException('systemCategory, systemCode, name required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    if (body.floorId) {
      const floor = await this.prisma.buildingFloor.findFirst({ where: { id: body.floorId, buildingId } });
      if (!floor) throw new BadRequestException('floorId not in building');
    }
    return this.prisma.buildingSystem.create({
      data: {
        tenantId, buildingId,
        systemCategory: body.systemCategory,
        systemCode: body.systemCode,
        name: body.name,
        locationType: body.locationType || null,
        floorId: body.floorId || null,
        quantity: body.quantity ?? null,
        status: body.status || 'active',
        notes: body.notes || null,
      },
    });
  }

  async updateSystem(tenantId: string, actorUserId: string, buildingIdOrSlug: string, systemId: string, patch: Record<string, any>) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const existing = await this.prisma.buildingSystem.findFirst({ where: { id: systemId, buildingId, tenantId } });
    if (!existing) throw new NotFoundException('system not found');
    const allowed = ['name', 'locationType', 'floorId', 'quantity', 'status', 'notes'];
    const data: Record<string, any> = {};
    for (const k of allowed) if (k in patch) data[k] = patch[k];
    return this.prisma.buildingSystem.update({ where: { id: existing.id }, data });
  }

  // ── Occupants ────────────────────────────────────────
  async listOccupants(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingOccupantCompany.findMany({
      where: { tenantId, buildingId },
      include: { occupancies: { include: { unit: { select: { unitCode: true, floorId: true } } } } },
      orderBy: { companyName: 'asc' },
    });
  }

  async createOccupant(tenantId: string, actorUserId: string, buildingIdOrSlug: string, body: {
    companyName: string; companyType?: string; contactName?: string; phone?: string; email?: string; notes?: string;
  }) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.companyName) throw new BadRequestException('companyName required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingOccupantCompany.create({
      data: {
        tenantId, buildingId,
        companyName: body.companyName,
        companyType: body.companyType || null,
        contactName: body.contactName || null,
        phone: body.phone || null,
        email: body.email || null,
        notes: body.notes || null,
      },
    });
  }

  async assignOccupancy(tenantId: string, actorUserId: string, buildingIdOrSlug: string, body: {
    unitId: string; occupantCompanyId: string; startDate?: string; endDate?: string; occupancyStatus?: string; notes?: string;
  }) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.unitId || !body.occupantCompanyId) throw new BadRequestException('unitId and occupantCompanyId required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const unit = await this.prisma.buildingUnit.findFirst({ where: { id: body.unitId, buildingId } });
    if (!unit) throw new BadRequestException('unit not in building');
    const company = await this.prisma.buildingOccupantCompany.findFirst({ where: { id: body.occupantCompanyId, buildingId } });
    if (!company) throw new BadRequestException('company not in building');
    return this.prisma.buildingUnitOccupancy.create({
      data: {
        tenantId, buildingId,
        unitId: body.unitId,
        occupantCompanyId: body.occupantCompanyId,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        occupancyStatus: body.occupancyStatus || 'active',
        notes: body.notes || null,
      },
    });
  }

  // ── Contracts ────────────────────────────────────────
  async listContracts(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingContract.findMany({
      where: { tenantId, buildingId },
      include: {
        occupantCompany: { select: { companyName: true } },
        unit: { select: { unitCode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createContract(tenantId: string, actorUserId: string, buildingIdOrSlug: string, body: {
    occupantCompanyId: string; unitId?: string; contractType: 'lease' | 'service'; contractNumber?: string; startDate?: string; endDate?: string; status?: string; amount?: number; currency?: string; notes?: string;
  }) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.occupantCompanyId || !body.contractType) throw new BadRequestException('occupantCompanyId and contractType required');
    if (!['lease', 'service'].includes(body.contractType)) throw new BadRequestException('contractType must be lease or service');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const company = await this.prisma.buildingOccupantCompany.findFirst({ where: { id: body.occupantCompanyId, buildingId } });
    if (!company) throw new BadRequestException('company not in building');
    if (body.unitId) {
      const unit = await this.prisma.buildingUnit.findFirst({ where: { id: body.unitId, buildingId } });
      if (!unit) throw new BadRequestException('unit not in building');
    }
    return this.prisma.buildingContract.create({
      data: {
        tenantId, buildingId,
        occupantCompanyId: body.occupantCompanyId,
        unitId: body.unitId || null,
        contractType: body.contractType,
        contractNumber: body.contractNumber || null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        status: body.status || 'draft',
        amount: body.amount ?? null,
        currency: body.currency || null,
        notes: body.notes || null,
      },
    });
  }

  // ── Aggregate view ───────────────────────────────────
  async summary(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) throw new NotFoundException('building not found');
    const [floors, units, transport, systems, occupants, contracts] = await Promise.all([
      this.prisma.buildingFloor.count({ where: { buildingId } }),
      this.prisma.buildingUnit.count({ where: { buildingId } }),
      this.prisma.buildingVerticalTransport.findMany({ where: { buildingId } }),
      this.prisma.buildingSystem.findMany({ where: { buildingId }, select: { systemCategory: true } }),
      this.prisma.buildingOccupantCompany.count({ where: { buildingId } }),
      this.prisma.buildingContract.count({ where: { buildingId } }),
    ]);
    const systemsByCategory = systems.reduce<Record<string, number>>((acc, s) => {
      acc[s.systemCategory] = (acc[s.systemCategory] || 0) + 1;
      return acc;
    }, {});
    return {
      building: {
        id: building.id, slug: building.slug, name: building.name,
        buildingType: building.buildingType, primaryUse: building.primaryUse,
        floorsAboveGround: building.floorsAboveGround, floorsBelowGround: building.floorsBelowGround,
      },
      counts: {
        floors, units, systems: systems.length,
        verticalTransport: transport.reduce((a, b) => a + b.quantity, 0),
        occupants, contracts,
      },
      transportByType: transport.reduce<Record<string, number>>((acc, t) => {
        acc[t.transportType] = (acc[t.transportType] || 0) + t.quantity;
        return acc;
      }, {}),
      systemsByCategory,
    };
  }
}
