import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface BuildingListItem {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  buildingType: string | null;
  address: string;
  organization: string;
  status: string;
  floorsCount: number | null;
  unitsCount: number | null;
  compliance: number;
}

@Injectable()
export class BuildingsService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(input: string): string {
    return input
      .toLowerCase().trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'building';
  }

  private async requireManager(tenantId: string, actorUserId: string) {
    const ws = await this.prisma.membership.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: { in: ['workspace_owner', 'workspace_admin', 'org_admin'] } },
    });
    if (ws) return;
    const br = await this.prisma.buildingRoleAssignment.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: { in: ['building_manager', 'chief_engineer'] } },
    });
    if (!br) throw new ForbiddenException('not authorized in this workspace');
  }

  async list(tenantId: string): Promise<BuildingListItem[]> {
    const buildings = await this.prisma.building.findMany({
      where: { tenantId },
      include: { organization: true },
      orderBy: { name: 'asc' },
    });
    return buildings.map((b) => ({
      id: b.id,
      tenantId: b.tenantId,
      slug: b.slug,
      name: b.name,
      buildingType: b.buildingType,
      address: `${b.addressLine1}, ${b.city}`,
      organization: b.organization?.name || 'Unassigned',
      status: b.status,
      floorsCount: b.floorsCount,
      unitsCount: b.unitsCount,
      compliance: b.compliance,
    }));
  }

  async getOne(tenantId: string, idOrSlug: string) {
    const where = idOrSlug.includes('-') && idOrSlug.length === 36
      ? { id: idOrSlug }
      : { tenantId_slug: { tenantId, slug: idOrSlug } };
    const building = await this.prisma.building.findUnique({
      where: where as any,
      include: {
        organization: true,
        entrances: { orderBy: { name: 'asc' } },
        floors: { orderBy: { number: 'asc' } },
        units: { orderBy: { number: 'asc' } },
        settings: true,
      },
    });
    if (!building || building.tenantId !== tenantId) throw new NotFoundException('building not found');
    const lifts = await this.prisma.asset.findMany({
      where: { buildingId: building.id, class: 'lift' },
      orderBy: { name: 'asc' },
    });
    return { ...building, lifts };
  }

  async create(
    tenantId: string,
    actorUserId: string,
    body: {
      name: string;
      slug?: string;
      addressLine1: string;
      city: string;
      countryCode: string;
      timezone: string;
      organizationId?: string;
      buildingType?: string;
      buildingCode?: string;
      primaryUse?: string;
      secondaryUses?: string[];
      complexityFlags?: string[];
      yearBuilt?: number;
      floorsAboveGround?: number;
      floorsBelowGround?: number;
      floorsCount?: number;
      unitsCount?: number;
      entrancesCount?: number;
      liftsCount?: number;
      hasParking?: boolean;
      hasRestaurantsGroundFloor?: boolean;
      hasRooftopMechanical?: boolean;
      notes?: string;
      status?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body.name || !body.addressLine1 || !body.city || !body.countryCode || !body.timezone) {
      throw new BadRequestException('name, addressLine1, city, countryCode, timezone required');
    }
    const slug = this.slugify(body.slug || body.name);
    const conflict = await this.prisma.building.findUnique({ where: { tenantId_slug: { tenantId, slug } } });
    if (conflict) throw new BadRequestException('building slug already taken');

    const building = await this.prisma.building.create({
      data: {
        tenantId,
        organizationId: body.organizationId || null,
        slug,
        name: body.name,
        addressLine1: body.addressLine1,
        city: body.city,
        countryCode: body.countryCode,
        timezone: body.timezone,
        type: body.buildingType === 'office_tower' || body.buildingType === 'office' ? 'Office'
              : body.buildingType === 'residential' ? 'Residential'
              : 'Commercial',
        buildingType: body.buildingType || null,
        buildingCode: body.buildingCode || null,
        primaryUse: body.primaryUse || null,
        secondaryUses: body.secondaryUses || [],
        complexityFlags: body.complexityFlags || [],
        yearBuilt: body.yearBuilt ?? null,
        floorsAboveGround: body.floorsAboveGround ?? null,
        floorsBelowGround: body.floorsBelowGround ?? null,
        floorsCount: body.floorsCount ?? null,
        unitsCount: body.unitsCount ?? null,
        entrancesCount: body.entrancesCount ?? null,
        liftsCount: body.liftsCount ?? null,
        hasParking: body.hasParking ?? null,
        hasRestaurantsGroundFloor: body.hasRestaurantsGroundFloor ?? null,
        hasRooftopMechanical: body.hasRooftopMechanical ?? null,
        notes: body.notes || null,
        status: body.status || 'active',
        createdBy: `user:${actorUserId}`,
      },
    });

    await this.prisma.buildingSettings.create({
      data: { buildingId: building.id, currency: 'USD', timezone: body.timezone, billingCycle: 'monthly', locale: 'en' },
    });

    await this.prisma.buildingRoleAssignment.create({
      data: { tenantId, buildingId: building.id, userId: actorUserId, roleKey: 'building_manager', delegatedBy: actorUserId },
    });

    if (body.organizationId) {
      await this.prisma.buildingMandate.create({
        data: {
          tenantId, buildingId: building.id, organizationId: body.organizationId,
          mandateType: 'owner', effectiveFrom: new Date(),
        },
      });
    }

    await this.prisma.auditEntry.create({
      data: {
        tenantId, buildingId: building.id, actor: actorUserId, role: 'workspace_owner',
        action: 'Building created', entity: building.slug, entityType: 'building',
        building: building.name, ip: '127.0.0.1', eventType: 'building.created',
        resourceType: 'building', resourceId: building.id,
      },
    });

    return building;
  }

  async update(tenantId: string, actorUserId: string, slug: string, patch: Record<string, any>) {
    await this.requireManager(tenantId, actorUserId);
    const existing = await this.prisma.building.findUnique({ where: { tenantId_slug: { tenantId, slug } } });
    if (!existing) throw new NotFoundException('building not found');

    const allowed: Array<keyof typeof patch> = [
      'name', 'buildingCode', 'buildingType', 'primaryUse', 'secondaryUses', 'complexityFlags',
      'yearBuilt', 'floorsAboveGround', 'floorsBelowGround',
      'floorsCount', 'unitsCount', 'entrancesCount', 'liftsCount',
      'hasParking', 'hasRestaurantsGroundFloor', 'hasRooftopMechanical',
      'street', 'buildingNumber', 'lat', 'lng', 'annualKwh', 'defaultLanguage', 'supportedLanguages',
      'status', 'organizationId', 'notes',
    ];
    const data: Record<string, any> = {};
    for (const k of allowed) if (k in patch) data[k] = patch[k];

    const updated = await this.prisma.building.update({ where: { id: existing.id }, data });

    await this.prisma.auditEntry.create({
      data: {
        tenantId, buildingId: existing.id, actor: actorUserId, role: 'building_manager',
        action: 'Building updated', entity: updated.slug, entityType: 'building',
        building: updated.name, ip: '127.0.0.1', eventType: 'building.updated',
        resourceType: 'building', resourceId: updated.id,
      },
    });
    return updated;
  }
}
