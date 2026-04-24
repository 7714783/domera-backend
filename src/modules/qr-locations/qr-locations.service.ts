import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveBuildingId } from '../../common/building.helpers';

@Injectable()
export class QrLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveBuildingId = (tenantId: string, idOrSlug: string) =>
    resolveBuildingId(this.prisma, tenantId, idOrSlug);

  async list(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const items = await this.prisma.qrLocation.findMany({
      where: { tenantId, buildingId },
      orderBy: { code: 'asc' },
    });
    return { total: items.length, items };
  }

  async create(
    tenantId: string,
    buildingIdOrSlug: string,
    body: {
      code: string;
      label: string;
      targetType: 'space' | 'equipment' | 'floor' | 'unit' | 'location';
      spaceId?: string;
      equipmentId?: string;
      floorId?: string;
      unitId?: string;
      notes?: string;
    },
  ) {
    if (!body.code || !body.label || !body.targetType)
      throw new BadRequestException('code, label, targetType required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);

    const ALLOWED_TYPES = ['space', 'equipment', 'floor', 'unit', 'location'] as const;
    if (!ALLOWED_TYPES.includes(body.targetType as (typeof ALLOWED_TYPES)[number])) {
      throw new BadRequestException(
        `targetType must be one of: ${ALLOWED_TYPES.join(', ')} (got "${body.targetType}")`,
      );
    }

    // Validate the target belongs to this building. Every concrete targetType
    // must point at a row that lives in this building — silent ref rot makes
    // the public scanner crash later (INIT-005 Phase 5).
    switch (body.targetType) {
      case 'floor': {
        if (!body.floorId) throw new BadRequestException('floorId required for targetType=floor');
        const f = await this.prisma.buildingFloor.findFirst({
          where: { id: body.floorId, buildingId },
        });
        if (!f) throw new BadRequestException('floor not in building');
        break;
      }
      case 'unit': {
        if (!body.unitId) throw new BadRequestException('unitId required for targetType=unit');
        const u = await this.prisma.buildingUnit.findFirst({
          where: { id: body.unitId, buildingId },
        });
        if (!u) throw new BadRequestException('unit not in building');
        break;
      }
      case 'equipment': {
        if (!body.equipmentId)
          throw new BadRequestException('equipmentId required for targetType=equipment');
        const e = await this.prisma.asset.findFirst({
          where: { id: body.equipmentId, buildingId },
        });
        if (!e) throw new BadRequestException('equipment not in building');
        break;
      }
      case 'location': {
        // BuildingLocation row (non-leasable common spaces). Stored in spaceId
        // since QrLocation has no dedicated locationId column.
        if (!body.spaceId)
          throw new BadRequestException('spaceId (BuildingLocation id) required for targetType=location');
        const l = await this.prisma.buildingLocation.findFirst({
          where: { id: body.spaceId, buildingId },
        });
        if (!l) throw new BadRequestException('location not in building');
        break;
      }
      case 'space': {
        // Generic space without a backing table. Accept spaceId as a free
        // string but require it so a downstream scanner can deref something.
        if (!body.spaceId) throw new BadRequestException('spaceId required for targetType=space');
        break;
      }
    }

    try {
      return await this.prisma.qrLocation.create({
        data: {
          tenantId,
          buildingId,
          code: body.code.trim().toUpperCase(),
          label: body.label,
          targetType: body.targetType,
          spaceId: body.spaceId || null,
          equipmentId: body.equipmentId || null,
          floorId: body.floorId || null,
          unitId: body.unitId || null,
          notes: body.notes || null,
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new BadRequestException('code already exists in this building');
      throw e;
    }
  }

  async resolveScan(tenantId: string, buildingIdOrSlug: string, code: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const row = await this.prisma.qrLocation.findFirst({
      where: { tenantId, buildingId, code: code.trim().toUpperCase() },
    });
    if (!row) throw new NotFoundException('QR code not found');

    let target: any = null;
    if (row.targetType === 'floor' && row.floorId) {
      target = await this.prisma.buildingFloor.findUnique({ where: { id: row.floorId } });
    } else if (row.targetType === 'unit' && row.unitId) {
      target = await this.prisma.buildingUnit.findUnique({
        where: { id: row.unitId },
        include: { floor: { select: { floorCode: true, floorNumber: true } } },
      });
    } else if (row.targetType === 'equipment' && row.equipmentId) {
      target = await this.prisma.asset.findUnique({ where: { id: row.equipmentId } });
    }

    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true, slug: true, name: true, tenantId: true },
    });

    return { qr: row, target, building };
  }

  async delete(tenantId: string, buildingIdOrSlug: string, code: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const row = await this.prisma.qrLocation.findFirst({
      where: { tenantId, buildingId, code: code.trim().toUpperCase() },
    });
    if (!row) throw new NotFoundException('QR code not found');
    await this.prisma.qrLocation.delete({ where: { id: row.id } });
    return { deleted: true };
  }
}
