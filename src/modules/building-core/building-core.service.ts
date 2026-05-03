import {
  BadRequestException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { requireManager, resolveBuildingId } from '../../common/building.helpers';

@Injectable()
export class BuildingCoreService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AssetsService)) private readonly assets: AssetsService,
  ) {}

  private requireManager = (tenantId: string, actorUserId: string) =>
    requireManager(this.prisma, tenantId, actorUserId);
  private resolveBuildingId = (tenantId: string, idOrSlug: string) =>
    resolveBuildingId(this.prisma, tenantId, idOrSlug);

  // ── Floors ───────────────────────────────────────────
  async listFloors(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingFloor.findMany({
      where: { tenantId, buildingId },
      orderBy: { floorNumber: 'asc' },
    });
  }

  async createFloor(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      floorCode: string;
      floorNumber: number;
      floorType: string;
      label?: string;
      grossAreaSqm?: number;
      isActive?: boolean;
      notes?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.floorCode || body.floorNumber === undefined || !body.floorType) {
      throw new BadRequestException('floorCode, floorNumber, floorType required');
    }
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingFloor.create({
      data: {
        tenantId,
        buildingId,
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
    const units = await this.prisma.buildingUnit.findMany({
      where: { tenantId, buildingId },
      include: {
        floor: { select: { floorCode: true, floorNumber: true } },
        group: { select: { id: true, groupCode: true, name: true, occupantCompanyId: true } },
        occupancies: {
          where: { occupancyStatus: 'active' },
          select: {
            id: true,
            startDate: true,
            endDate: true,
            occupancyStatus: true,
            occupantCompany: { select: { id: true, companyName: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ floor: { floorNumber: 'asc' } }, { unitCode: 'asc' }],
    });
    return units.map((u) => {
      const active = u.occupancies[0] || null;
      return {
        ...u,
        occupant: active?.occupantCompany || null,
        occupancies: undefined,
      };
    });
  }

  async createUnit(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      floorId: string;
      unitCode: string;
      unitType: string;
      areaSqm?: number;
      layoutZone?: string;
      isDivisible?: boolean;
      status?: string;
      notes?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.floorId || !body.unitCode || !body.unitType)
      throw new BadRequestException('floorId, unitCode, unitType required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const floor = await this.prisma.buildingFloor.findFirst({
      where: { id: body.floorId, buildingId },
    });
    if (!floor) throw new BadRequestException('floor not found in this building');

    return this.prisma.buildingUnit.create({
      data: {
        tenantId,
        buildingId,
        floorId: body.floorId,
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

  async updateUnit(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    unitId: string,
    patch: {
      unitCode?: string;
      unitType?: string;
      areaSqm?: number | null;
      layoutZone?: string | null;
      isDivisible?: boolean;
      status?: string;
      notes?: string | null;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const existing = await this.prisma.buildingUnit.findFirst({
      where: { id: unitId, buildingId, tenantId },
    });
    if (!existing) throw new NotFoundException('unit not found');
    return this.prisma.buildingUnit.update({ where: { id: existing.id }, data: patch as any });
  }

  // ── Unit groups (combined offices) ───────────────────
  // A group merges 2+ BuildingUnits into one logical rented office for a
  // single occupant company. Units keep their individual identity (floor plan,
  // QRs, asset links) but aggregate totals (area, PPM cost, contracts) roll
  // up to the group.

  async listUnitGroups(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const groups = await this.prisma.buildingUnitGroup.findMany({
      where: { tenantId, buildingId },
      include: {
        occupantCompany: { select: { id: true, companyName: true } },
        units: {
          select: {
            id: true,
            unitCode: true,
            unitType: true,
            areaSqm: true,
            floorId: true,
            status: true,
            floor: { select: { floorCode: true, floorNumber: true } },
          },
          orderBy: [{ floor: { floorNumber: 'asc' } }, { unitCode: 'asc' }],
        },
      },
      orderBy: { groupCode: 'asc' },
    });
    return groups.map((g) => ({
      ...g,
      totalAreaSqm: g.units.reduce((s, u) => s + (u.areaSqm ?? 0), 0),
      unitCount: g.units.length,
    }));
  }

  async createUnitGroup(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      groupCode: string;
      name: string;
      occupantCompanyId?: string | null;
      unitIds: string[];
      notes?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    if (!body.groupCode || !body.name) throw new BadRequestException('groupCode and name required');
    if (!Array.isArray(body.unitIds) || body.unitIds.length < 2) {
      throw new BadRequestException('at least two unitIds required to form a group');
    }
    const uniqueIds = Array.from(new Set(body.unitIds));
    const units = await this.prisma.buildingUnit.findMany({
      where: { id: { in: uniqueIds }, tenantId, buildingId },
      select: { id: true, groupId: true, unitCode: true },
    });
    if (units.length !== uniqueIds.length)
      throw new BadRequestException('one or more units not in this building');
    const alreadyGrouped = units.filter((u) => u.groupId);
    if (alreadyGrouped.length) {
      throw new BadRequestException(
        `units already in a group: ${alreadyGrouped.map((u) => u.unitCode).join(', ')}`,
      );
    }
    if (body.occupantCompanyId) {
      const company = await this.prisma.buildingOccupantCompany.findFirst({
        where: { id: body.occupantCompanyId, tenantId, buildingId },
        select: { id: true },
      });
      if (!company) throw new BadRequestException('occupantCompany not in this building');
    }

    return this.prisma.$transaction(async (tx) => {
      const group = await tx.buildingUnitGroup.create({
        data: {
          tenantId,
          buildingId,
          groupCode: body.groupCode.trim(),
          name: body.name.trim(),
          occupantCompanyId: body.occupantCompanyId || null,
          notes: body.notes?.trim() || null,
        },
      });
      await tx.buildingUnit.updateMany({
        where: { id: { in: uniqueIds }, tenantId, buildingId },
        data: { groupId: group.id },
      });
      return group;
    });
  }

  async updateUnitGroup(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    groupId: string,
    patch: {
      name?: string;
      occupantCompanyId?: string | null;
      notes?: string | null;
      addUnitIds?: string[];
      removeUnitIds?: string[];
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const group = await this.prisma.buildingUnitGroup.findFirst({
      where: { id: groupId, tenantId, buildingId },
    });
    if (!group) throw new NotFoundException('group not found');

    if (patch.occupantCompanyId) {
      const company = await this.prisma.buildingOccupantCompany.findFirst({
        where: { id: patch.occupantCompanyId, tenantId, buildingId },
        select: { id: true },
      });
      if (!company) throw new BadRequestException('occupantCompany not in this building');
    }

    return this.prisma.$transaction(async (tx) => {
      const data: Record<string, any> = {};
      if (patch.name !== undefined) data.name = patch.name.trim();
      if (patch.occupantCompanyId !== undefined)
        data.occupantCompanyId = patch.occupantCompanyId || null;
      if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
      if (Object.keys(data).length)
        await tx.buildingUnitGroup.update({ where: { id: group.id }, data });

      if (patch.addUnitIds?.length) {
        const units = await tx.buildingUnit.findMany({
          where: { id: { in: patch.addUnitIds }, tenantId, buildingId },
          select: { id: true, groupId: true, unitCode: true },
        });
        if (units.length !== patch.addUnitIds.length)
          throw new BadRequestException('one or more units not in this building');
        const otherGroup = units.filter((u) => u.groupId && u.groupId !== group.id);
        if (otherGroup.length)
          throw new BadRequestException(
            `units already in another group: ${otherGroup.map((u) => u.unitCode).join(', ')}`,
          );
        await tx.buildingUnit.updateMany({
          where: { id: { in: patch.addUnitIds }, tenantId, buildingId },
          data: { groupId: group.id },
        });
      }
      if (patch.removeUnitIds?.length) {
        await tx.buildingUnit.updateMany({
          where: { id: { in: patch.removeUnitIds }, tenantId, buildingId, groupId: group.id },
          data: { groupId: null },
        });
      }

      return tx.buildingUnitGroup.findUnique({
        where: { id: group.id },
        include: {
          units: { select: { id: true, unitCode: true } },
          occupantCompany: { select: { id: true, companyName: true } },
        },
      });
    });
  }

  async deleteUnitGroup(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    groupId: string,
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const group = await this.prisma.buildingUnitGroup.findFirst({
      where: { id: groupId, tenantId, buildingId },
    });
    if (!group) throw new NotFoundException('group not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.buildingUnit.updateMany({
        where: { groupId: group.id, tenantId, buildingId },
        data: { groupId: null },
      });
      await tx.buildingUnitGroup.delete({ where: { id: group.id } });
      return { ok: true };
    });
  }

  // ── Vertical transport ───────────────────────────────
  async listTransport(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingVerticalTransport.findMany({
      where: { tenantId, buildingId },
      orderBy: { code: 'asc' },
    });
  }

  async createTransport(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      code: string;
      transportType: string;
      servesFromFloor: number;
      servesToFloor: number;
      quantity?: number;
      status?: string;
      notes?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (
      !body.code ||
      !body.transportType ||
      body.servesFromFloor === undefined ||
      body.servesToFloor === undefined
    ) {
      throw new BadRequestException('code, transportType, servesFromFloor, servesToFloor required');
    }
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    const minFloor = -(building?.floorsBelowGround ?? 10);
    const maxFloor = building?.floorsAboveGround ?? 50;
    if (body.servesFromFloor < minFloor - 2 || body.servesToFloor > maxFloor + 2) {
      throw new BadRequestException(
        `serves range out of building bounds (${minFloor}..${maxFloor})`,
      );
    }
    return this.prisma.buildingVerticalTransport.create({
      data: {
        tenantId,
        buildingId,
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

  async createSystem(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      systemCategory: string;
      systemCode: string;
      name: string;
      locationType?: string;
      floorId?: string;
      quantity?: number;
      status?: string;
      notes?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.systemCategory || !body.systemCode || !body.name)
      throw new BadRequestException('systemCategory, systemCode, name required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    if (body.floorId) {
      const floor = await this.prisma.buildingFloor.findFirst({
        where: { id: body.floorId, buildingId },
      });
      if (!floor) throw new BadRequestException('floorId not in building');
    }
    return this.prisma.buildingSystem.create({
      data: {
        tenantId,
        buildingId,
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

  async updateSystem(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    systemId: string,
    patch: Record<string, any>,
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const existing = await this.prisma.buildingSystem.findFirst({
      where: { id: systemId, buildingId, tenantId },
    });
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
      include: {
        occupancies: { include: { unit: { select: { unitCode: true, floorId: true } } } },
      },
      orderBy: { companyName: 'asc' },
    });
  }

  async createOccupant(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      companyName: string;
      companyType?: string;
      contactName?: string;
      phone?: string;
      email?: string;
      notes?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.companyName) throw new BadRequestException('companyName required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingOccupantCompany.create({
      data: {
        tenantId,
        buildingId,
        companyName: body.companyName,
        companyType: body.companyType || null,
        contactName: body.contactName || null,
        phone: body.phone || null,
        email: body.email || null,
        notes: body.notes || null,
      },
    });
  }

  async assignOccupancy(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      unitId: string;
      occupantCompanyId: string;
      startDate?: string;
      endDate?: string;
      occupancyStatus?: string;
      notes?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.unitId || !body.occupantCompanyId)
      throw new BadRequestException('unitId and occupantCompanyId required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const unit = await this.prisma.buildingUnit.findFirst({
      where: { id: body.unitId, buildingId },
    });
    if (!unit) throw new BadRequestException('unit not in building');
    const company = await this.prisma.buildingOccupantCompany.findFirst({
      where: { id: body.occupantCompanyId, buildingId },
    });
    if (!company) throw new BadRequestException('company not in building');
    return this.prisma.buildingUnitOccupancy.create({
      data: {
        tenantId,
        buildingId,
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

  async createContract(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      occupantCompanyId: string;
      unitId?: string;
      contractType: 'lease' | 'service';
      contractNumber?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      amount?: number;
      currency?: string;
      notes?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.occupantCompanyId || !body.contractType)
      throw new BadRequestException('occupantCompanyId and contractType required');
    if (!['lease', 'service'].includes(body.contractType))
      throw new BadRequestException('contractType must be lease or service');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const company = await this.prisma.buildingOccupantCompany.findFirst({
      where: { id: body.occupantCompanyId, buildingId },
    });
    if (!company) throw new BadRequestException('company not in building');
    if (body.unitId) {
      const unit = await this.prisma.buildingUnit.findFirst({
        where: { id: body.unitId, buildingId },
      });
      if (!unit) throw new BadRequestException('unit not in building');
    }
    return this.prisma.buildingContract.create({
      data: {
        tenantId,
        buildingId,
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

  // ── Canonical locations (single source of truth) ─────
  // Unified view: BuildingLocation rows (non-leasable: restrooms, corridors,
  // lobbies, mechanical rooms) + BuildingUnit rows (leasable: offices,
  // storage) — projected into the same shape. Every module that needs a
  // physical space references this endpoint — rooms are created here,
  // nowhere else.
  async listLocations(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const [locations, units, floors] = await Promise.all([
      this.prisma.buildingLocation.findMany({
        where: { tenantId, buildingId },
        orderBy: [{ floorId: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.buildingUnit.findMany({
        where: { tenantId, buildingId },
        orderBy: [{ floorId: 'asc' }, { unitCode: 'asc' }],
      }),
      this.prisma.buildingFloor.findMany({
        where: { tenantId, buildingId },
        select: { id: true, floorCode: true, floorNumber: true, label: true },
      }),
    ]);
    const floorById = new Map(floors.map((f) => [f.id, f]));
    const asUnits = units.map((u) => ({
      id: u.id,
      source: 'unit' as const,
      tenantId: u.tenantId,
      buildingId: u.buildingId,
      floorId: u.floorId,
      floorNumber: floorById.get(u.floorId)?.floorNumber ?? null,
      floorCode: floorById.get(u.floorId)?.floorCode ?? null,
      code: u.unitCode,
      name: u.unitCode,
      locationType: u.unitType,
      areaSqm: u.areaSqm,
      isLeasable: true,
      unitId: u.id,
      notes: u.notes,
      isActive: u.status !== 'decommissioned',
    }));
    const asLocations = locations.map((l) => ({
      id: l.id,
      source: 'location' as const,
      tenantId: l.tenantId,
      buildingId: l.buildingId,
      floorId: l.floorId,
      floorNumber: floorById.get(l.floorId)?.floorNumber ?? null,
      floorCode: floorById.get(l.floorId)?.floorCode ?? null,
      code: l.code,
      name: l.name,
      locationType: l.locationType,
      areaSqm: l.areaSqm,
      isLeasable: l.isLeasable,
      unitId: l.unitId,
      notes: l.notes,
      isActive: l.isActive,
    }));
    return [...asUnits, ...asLocations].sort((a, b) => {
      const fa = a.floorNumber ?? Number.POSITIVE_INFINITY;
      const fb = b.floorNumber ?? Number.POSITIVE_INFINITY;
      if (fa !== fb) return fa - fb;
      return a.code.localeCompare(b.code);
    });
  }

  async createLocation(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      floorId: string;
      code: string;
      name: string;
      locationType: string;
      areaSqm?: number;
      notes?: string;
      isLeasable?: boolean;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.floorId || !body.code || !body.name || !body.locationType) {
      throw new BadRequestException('floorId, code, name, locationType required');
    }
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const floor = await this.prisma.buildingFloor.findFirst({
      where: { id: body.floorId, tenantId, buildingId },
    });
    if (!floor) throw new NotFoundException('floor not found in this building');
    const dupeLoc = await this.prisma.buildingLocation.findFirst({
      where: { buildingId, code: body.code },
    });
    if (dupeLoc) throw new BadRequestException(`code "${body.code}" already exists as a location`);
    const dupeUnit = await this.prisma.buildingUnit.findFirst({
      where: { buildingId, unitCode: body.code },
    });
    if (dupeUnit)
      throw new BadRequestException(`code "${body.code}" already exists as a unit — pick another`);
    return this.prisma.buildingLocation.create({
      data: {
        tenantId,
        buildingId,
        floorId: body.floorId,
        code: body.code,
        name: body.name,
        locationType: body.locationType,
        areaSqm: body.areaSqm ?? null,
        notes: body.notes || null,
        isLeasable: !!body.isLeasable,
      },
    });
  }

  // ── Parking spots ────────────────────────────────────
  async listParking(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.parkingSpot.findMany({
      where: { tenantId, buildingId },
      orderBy: { code: 'asc' },
    });
  }

  async createParking(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      code: string;
      floorId?: string;
      spotType?: string;
      features?: string[];
      isLeased?: boolean;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.code) throw new BadRequestException('code required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.parkingSpot.create({
      data: {
        tenantId,
        buildingId,
        code: body.code,
        floorId: body.floorId || null,
        spotType: body.spotType || 'reserved',
        features: body.features || [],
        isLeased: body.isLeased ?? false,
      },
    });
  }

  // ── Storage units ────────────────────────────────────
  async listStorage(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.storageUnit.findMany({
      where: { tenantId, buildingId },
      orderBy: { code: 'asc' },
    });
  }

  async createStorage(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      code: string;
      floorId?: string;
      areaSqm?: number;
      isClimateControlled?: boolean;
      isLeased?: boolean;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.code) throw new BadRequestException('code required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.storageUnit.create({
      data: {
        tenantId,
        buildingId,
        code: body.code,
        floorId: body.floorId || null,
        areaSqm: body.areaSqm ?? null,
        isClimateControlled: body.isClimateControlled ?? false,
        isLeased: body.isLeased ?? false,
      },
    });
  }

  // ── Equipment relations (parent/child) ───────────────
  async listEquipmentRelations(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.equipmentRelation.findMany({ where: { tenantId, buildingId } });
  }

  async createEquipmentRelation(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      parentAssetId: string;
      childAssetId: string;
      relationType?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.parentAssetId || !body.childAssetId)
      throw new BadRequestException('parentAssetId and childAssetId required');
    if (body.parentAssetId === body.childAssetId)
      throw new BadRequestException('parent and child must differ');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.equipmentRelation.create({
      data: {
        tenantId,
        buildingId,
        parentAssetId: body.parentAssetId,
        childAssetId: body.childAssetId,
        relationType: body.relationType || 'contains',
      },
    });
  }

  // ── Elevator profile (subtype of asset) ──────────────
  async listElevatorProfiles(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.elevatorProfile.findMany({ where: { tenantId, buildingId } });
  }

  async upsertElevatorProfile(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      assetId: string;
      shaftCode?: string;
      carType?: string;
      capacityKg?: number;
      servedFromFloor?: number;
      servedToFloor?: number;
      speedMps?: number;
      controllerModel?: string;
      vendorOrgId?: string;
      rescueMode?: string;
      lastInspectionAt?: string;
      nextInspectionDue?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.assetId) throw new BadRequestException('assetId required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const data = {
      tenantId,
      buildingId,
      assetId: body.assetId,
      shaftCode: body.shaftCode || null,
      carType: body.carType || null,
      capacityKg: body.capacityKg ?? null,
      servedFromFloor: body.servedFromFloor ?? null,
      servedToFloor: body.servedToFloor ?? null,
      speedMps: body.speedMps ?? null,
      controllerModel: body.controllerModel || null,
      vendorOrgId: body.vendorOrgId || null,
      rescueMode: body.rescueMode || null,
      lastInspectionAt: body.lastInspectionAt ? new Date(body.lastInspectionAt) : null,
      nextInspectionDue: body.nextInspectionDue ? new Date(body.nextInspectionDue) : null,
    };
    return this.prisma.elevatorProfile.upsert({
      where: { assetId: body.assetId },
      create: data,
      update: data,
    });
  }

  // ── Sensor points ────────────────────────────────────
  async listSensorPoints(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.sensorPoint.findMany({
      where: { tenantId, buildingId },
      orderBy: { name: 'asc' },
    });
  }

  async createSensorPoint(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      assetId: string;
      name: string;
      pointType: string;
      unit?: string;
      bacnetId?: string;
      opcNodeId?: string;
      haystackRef?: string;
      haystackTags?: string[];
      brickClass?: string;
      minValue?: number;
      maxValue?: number;
      sampleRateS?: number;
      isActive?: boolean;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.assetId || !body.name || !body.pointType) {
      throw new BadRequestException('assetId, name, pointType required');
    }
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const asset = await this.prisma.asset.findFirst({
      where: { id: body.assetId, tenantId, buildingId },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('asset not found in this building');
    return this.prisma.sensorPoint.create({
      data: {
        tenantId,
        buildingId,
        assetId: body.assetId,
        name: body.name,
        pointType: body.pointType,
        unit: body.unit || null,
        bacnetId: body.bacnetId || null,
        opcNodeId: body.opcNodeId || null,
        haystackRef: body.haystackRef || null,
        haystackTags: body.haystackTags || [],
        brickClass: body.brickClass || null,
        minValue: body.minValue ?? null,
        maxValue: body.maxValue ?? null,
        sampleRateS: body.sampleRateS ?? null,
        isActive: body.isActive ?? true,
      },
    });
  }

  // ── Alarm sources ────────────────────────────────────
  async listAlarmSources(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.alarmSource.findMany({
      where: { tenantId, buildingId },
      orderBy: { severity: 'asc' },
    });
  }

  async createAlarmSource(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      assetId: string;
      name: string;
      severity?: string;
      source: string;
      bacnetId?: string;
      opcNodeId?: string;
      haystackRef?: string;
      haystackTags?: string[];
      brickClass?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.assetId || !body.name || !body.source) {
      throw new BadRequestException('assetId, name, source required');
    }
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const asset = await this.prisma.asset.findFirst({
      where: { id: body.assetId, tenantId, buildingId },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('asset not found in this building');
    return this.prisma.alarmSource.create({
      data: {
        tenantId,
        buildingId,
        assetId: body.assetId,
        name: body.name,
        severity: body.severity || 'warning',
        source: body.source,
        bacnetId: body.bacnetId || null,
        opcNodeId: body.opcNodeId || null,
        haystackRef: body.haystackRef || null,
        haystackTags: body.haystackTags || [],
        brickClass: body.brickClass || null,
      },
    });
  }

  // ── Asset semantic tags (Haystack + Brick) ───────────
  // Building-core authorizes + resolves, but the DB write is delegated to
  // AssetsService (the sole owner of the assets table).
  async tagAsset(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    assetId: string,
    body: {
      haystackTags?: string[];
      brickClass?: string;
      brickRelations?: unknown;
      externalIds?: unknown;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.assets.setSemanticTags(tenantId, assetId, buildingId, body);
  }

  async summary(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) throw new NotFoundException('building not found');
    const [floors, units, transport, systems, occupants, contracts, spaces, elements] =
      await Promise.all([
        this.prisma.buildingFloor.count({ where: { buildingId } }),
        this.prisma.buildingUnit.count({ where: { buildingId } }),
        this.prisma.buildingVerticalTransport.findMany({ where: { buildingId } }),
        this.prisma.buildingSystem.findMany({
          where: { buildingId },
          select: { systemCategory: true },
        }),
        this.prisma.buildingOccupantCompany.count({ where: { buildingId } }),
        this.prisma.buildingContract.count({ where: { buildingId } }),
        this.prisma.buildingSpace.count({ where: { tenantId, buildingId } }),
        this.prisma.buildingElement.count({ where: { tenantId, buildingId } }),
      ]);
    const systemsByCategory = systems.reduce<Record<string, number>>((acc, s) => {
      acc[s.systemCategory] = (acc[s.systemCategory] || 0) + 1;
      return acc;
    }, {});
    return {
      building: {
        id: building.id,
        slug: building.slug,
        name: building.name,
        buildingType: building.buildingType,
        primaryUse: building.primaryUse,
        floorsAboveGround: building.floorsAboveGround,
        floorsBelowGround: building.floorsBelowGround,
      },
      counts: {
        floors,
        units,
        systems: systems.length,
        verticalTransport: transport.reduce((a, b) => a + b.quantity, 0),
        occupants,
        contracts,
        spaces,
        elements,
      },
      transportByType: transport.reduce<Record<string, number>>((acc, t) => {
        acc[t.transportType] = (acc[t.transportType] || 0) + t.quantity;
        return acc;
      }, {}),
      systemsByCategory,
    };
  }
}
