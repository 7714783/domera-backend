import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { requireManager, resolveBuildingId } from '../../common/building.helpers';

// Occupants (Арендаторы) module — a consolidated view of a company renting
// in a building: their offices (units + groups), contracts, parking, storage,
// cleaning allocation, representatives, open service requests, and per-tenant
// settings. Backed by BuildingOccupantCompany + new OccupantCompanySettings.
//
// Endpoints are mounted at /v1/buildings/:id/tenants (building-scoped list &
// detail) and /v1/tenants (portfolio-wide list).

const DEFAULT_SETTINGS = {
  cleaningFrequency: 'daily' as const,
  cleaningSlaHours: 24,
  cleaningZone: null as string | null,
  parkingCount: 0,
  storageCount: 0,
  insuranceRequired: true,
  insuranceExpiresAt: null as Date | null,
  accessCardCount: 0,
  allowsAfterHours: false,
  billingEmail: null as string | null,
  preferredLanguage: 'en',
  notificationChannels: [] as string[],
  notes: null as string | null,
  customFields: null as any,
};

@Injectable()
export class OccupantsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager = (tenantId: string, actorUserId: string) =>
    requireManager(this.prisma, tenantId, actorUserId);
  private resolveBuildingId = (tenantId: string, idOrSlug: string) =>
    resolveBuildingId(this.prisma, tenantId, idOrSlug);

  // Portfolio-wide list — all occupant companies across every building the
  // caller's tenant has access to. Useful for the top-level /tenants page.
  // Excludes `vendor`-typed companies: the PPM seed reuses this table as a
  // counterparty for service contracts (Chillers — biannual service, Lifts —
  // monthly preventive, etc.). Those are building systems maintenance
  // vendors, not actual lessees, and must not show up in "Tenants".
  async listPortfolio(tenantId: string) {
    const rows = await this.prisma.buildingOccupantCompany.findMany({
      where: { tenantId, companyType: { not: 'vendor' } },
      include: {
        building: { select: { id: true, slug: true, name: true } },
        settings: true,
        _count: { select: { occupancies: true, contracts: true, unitGroups: true } },
      },
      orderBy: { companyName: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      companyName: r.companyName,
      companyType: r.companyType,
      contactName: r.contactName,
      email: r.email,
      phone: r.phone,
      building: r.building,
      unitsCount: r._count.occupancies,
      contractsCount: r._count.contracts,
      groupsCount: r._count.unitGroups,
      settings: r.settings || { ...DEFAULT_SETTINGS, occupantCompanyId: r.id },
    }));
  }

  // Building-scoped list with aggregates per tenant. Vendor-typed companies
  // (PPM service counterparties: chiller vendors, fire-safety contractors,
  // lift maintenance) are filtered out — they belong to the Vendors module,
  // not Tenants.
  async listForBuilding(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const rows = await this.prisma.buildingOccupantCompany.findMany({
      where: { tenantId, buildingId, companyType: { not: 'vendor' } },
      include: {
        settings: true,
        occupancies: {
          where: { occupancyStatus: 'active' },
          select: {
            unit: {
              select: {
                id: true,
                unitCode: true,
                areaSqm: true,
                floor: { select: { floorCode: true } },
              },
            },
          },
        },
        unitGroups: {
          select: { id: true, groupCode: true, name: true, units: { select: { areaSqm: true } } },
        },
        contracts: {
          where: { status: { in: ['active', 'draft'] } },
          select: {
            id: true,
            status: true,
            amount: true,
            currency: true,
            endDate: true,
            contractType: true,
          },
        },
      },
      orderBy: { companyName: 'asc' },
    });
    return rows.map((r) => {
      const totalArea = r.occupancies.reduce((s, o) => s + (o.unit?.areaSqm ?? 0), 0);
      const active = r.contracts.find((c) => c.status === 'active');
      return {
        id: r.id,
        companyName: r.companyName,
        companyType: r.companyType,
        contactName: r.contactName,
        email: r.email,
        phone: r.phone,
        totalAreaSqm: totalArea,
        unitsCount: r.occupancies.length,
        groupsCount: r.unitGroups.length,
        activeContract: active
          ? {
              id: active.id,
              amount: active.amount,
              currency: active.currency,
              endDate: active.endDate,
              contractType: active.contractType,
            }
          : null,
        settings: r.settings || { ...DEFAULT_SETTINGS, occupantCompanyId: r.id },
      };
    });
  }

  async getOne(tenantId: string, buildingIdOrSlug: string, occupantId: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const row = await this.prisma.buildingOccupantCompany.findFirst({
      where: { id: occupantId, tenantId, buildingId, companyType: { not: 'vendor' } },
      include: {
        building: { select: { id: true, slug: true, name: true } },
        settings: true,
        occupancies: {
          include: {
            unit: {
              select: {
                id: true,
                unitCode: true,
                unitType: true,
                areaSqm: true,
                status: true,
                floor: { select: { floorCode: true, floorNumber: true } },
                group: { select: { id: true, groupCode: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        unitGroups: {
          include: {
            units: {
              select: {
                id: true,
                unitCode: true,
                areaSqm: true,
                floor: { select: { floorCode: true } },
              },
            },
          },
        },
        contracts: {
          include: {
            unit: { select: { unitCode: true } },
            allocations: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!row) throw new NotFoundException('tenant not found');

    // Representatives (users linked to this occupant company).
    const reps = await this.prisma.tenantRepresentative.findMany({
      where: { tenantId, occupantCompanyId: occupantId, status: 'active' },
      select: { id: true, userId: true, role: true, invitedByUserId: true, createdAt: true },
    });
    const users = reps.length
      ? await this.prisma.user.findMany({
          where: { id: { in: reps.map((r) => r.userId) } },
          select: { id: true, username: true, displayName: true, email: true },
        })
      : [];
    const usersById = new Map(users.map((u) => [u.id, u]));

    // Cleaning requests opened by (or for) this tenant. We filter by occupantCompanyId
    // on CleaningRequest if such a column exists; otherwise fall back to empty.
    let cleaningRequests: Array<{
      id: string;
      status: string;
      title: string;
      requestedAt: Date | null;
      priority: string | null;
    }> = [];
    try {
      const rows = await (this.prisma as any).cleaningRequest.findMany({
        where: { tenantId, buildingId, occupantCompanyId: occupantId },
        select: { id: true, status: true, title: true, requestedAt: true, priority: true },
        orderBy: { requestedAt: 'desc' },
        take: 50,
      });
      cleaningRequests = rows;
    } catch {
      /* table/column absent in this env — leave empty */
    }

    const totalAreaSqm = row.occupancies.reduce((s, o) => s + (o.unit?.areaSqm ?? 0), 0);

    return {
      id: row.id,
      companyName: row.companyName,
      companyType: row.companyType,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      notes: row.notes,
      building: row.building,
      totalAreaSqm,
      units: row.occupancies.map((o) => ({
        occupancyId: o.id,
        startDate: o.startDate,
        endDate: o.endDate,
        occupancyStatus: o.occupancyStatus,
        ...o.unit,
      })),
      groups: row.unitGroups.map((g) => ({
        id: g.id,
        groupCode: g.groupCode,
        name: g.name,
        totalAreaSqm: g.units.reduce((s, u) => s + (u.areaSqm ?? 0), 0),
        unitCount: g.units.length,
        units: g.units,
      })),
      contracts: row.contracts.map((c) => ({
        id: c.id,
        contractType: c.contractType,
        contractNumber: c.contractNumber,
        status: c.status,
        amount: c.amount,
        currency: c.currency,
        startDate: c.startDate,
        endDate: c.endDate,
        unitCode: c.unit?.unitCode || null,
        allocations: c.allocations,
      })),
      representatives: reps.map((r) => ({
        id: r.id,
        role: r.role,
        createdAt: r.createdAt,
        user: usersById.get(r.userId) || null,
      })),
      cleaningRequests,
      settings: row.settings || { ...DEFAULT_SETTINGS, occupantCompanyId: row.id },
    };
  }

  async upsertSettings(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    occupantId: string,
    patch: Partial<{
      cleaningFrequency: string;
      cleaningSlaHours: number;
      cleaningZone: string | null;
      parkingCount: number;
      storageCount: number;
      insuranceRequired: boolean;
      insuranceExpiresAt: string | null;
      accessCardCount: number;
      allowsAfterHours: boolean;
      billingEmail: string | null;
      preferredLanguage: string;
      notificationChannels: string[];
      notes: string | null;
      customFields: any;
    }>,
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const company = await this.prisma.buildingOccupantCompany.findFirst({
      where: { id: occupantId, tenantId, buildingId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('tenant not found');

    // Normalise numeric fields + dates.
    const data: Record<string, any> = { tenantId, occupantCompanyId: occupantId };
    const assignIfSet = (k: string, v: any) => {
      if (v !== undefined) data[k] = v;
    };
    assignIfSet('cleaningFrequency', patch.cleaningFrequency);
    assignIfSet('cleaningSlaHours', patch.cleaningSlaHours);
    assignIfSet('cleaningZone', patch.cleaningZone);
    assignIfSet('parkingCount', patch.parkingCount);
    assignIfSet('storageCount', patch.storageCount);
    assignIfSet('insuranceRequired', patch.insuranceRequired);
    if (patch.insuranceExpiresAt !== undefined) {
      data.insuranceExpiresAt = patch.insuranceExpiresAt
        ? new Date(patch.insuranceExpiresAt)
        : null;
    }
    assignIfSet('accessCardCount', patch.accessCardCount);
    assignIfSet('allowsAfterHours', patch.allowsAfterHours);
    assignIfSet('billingEmail', patch.billingEmail);
    assignIfSet('preferredLanguage', patch.preferredLanguage);
    assignIfSet('notificationChannels', patch.notificationChannels);
    assignIfSet('notes', patch.notes);
    assignIfSet('customFields', patch.customFields);

    // Prisma upsert: create needs the relation, not the scalar FK. Build the
    // create payload with explicit fields + occupantCompany connection.
    const createPayload: any = {
      tenantId,
      occupantCompany: { connect: { id: occupantId } },
      ...DEFAULT_SETTINGS,
      ...data,
    };
    delete createPayload.occupantCompanyId;
    if (data.insuranceExpiresAt !== undefined)
      createPayload.insuranceExpiresAt = data.insuranceExpiresAt;
    const updatePayload: any = { ...data };
    delete updatePayload.tenantId;
    delete updatePayload.occupantCompanyId;

    return this.prisma.occupantCompanySettings.upsert({
      where: { occupantCompanyId: occupantId },
      create: createPayload,
      update: updatePayload,
    });
  }

  async createTenant(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      companyName: string;
      companyType?: string | null;
      contactName?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    if (!body.companyName?.trim()) throw new BadRequestException('companyName required');
    // Guard against the old PPM-seed shortcut: tenants shouldn't be created
    // as vendors from this endpoint.
    if (body.companyType && body.companyType.toLowerCase() === 'vendor') {
      throw new BadRequestException('vendor type not allowed for tenants — use the vendors module');
    }
    return this.prisma.buildingOccupantCompany.create({
      data: {
        tenantId,
        buildingId,
        companyName: body.companyName.trim(),
        companyType: body.companyType?.trim() || null,
        contactName: body.contactName?.trim() || null,
        phone: body.phone?.trim() || null,
        email: body.email?.trim() || null,
        notes: body.notes?.trim() || null,
      },
    });
  }

  async patchProfile(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    occupantId: string,
    patch: {
      companyName?: string;
      companyType?: string | null;
      contactName?: string | null;
      phone?: string | null;
      email?: string | null;
      notes?: string | null;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const company = await this.prisma.buildingOccupantCompany.findFirst({
      where: { id: occupantId, tenantId, buildingId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('tenant not found');
    const data: Record<string, any> = {};
    if (patch.companyName !== undefined) {
      if (!patch.companyName.trim()) throw new BadRequestException('companyName cannot be empty');
      data.companyName = patch.companyName.trim();
    }
    if (patch.companyType !== undefined) data.companyType = patch.companyType;
    if (patch.contactName !== undefined) data.contactName = patch.contactName;
    if (patch.phone !== undefined) data.phone = patch.phone;
    if (patch.email !== undefined) data.email = patch.email;
    if (patch.notes !== undefined) data.notes = patch.notes;
    return this.prisma.buildingOccupantCompany.update({ where: { id: occupantId }, data });
  }
}
