import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class QrLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveBuildingId(tenantId: string, idOrSlug: string): Promise<string> {
    const b = await this.prisma.building.findFirst({
      where: { tenantId, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      select: { id: true },
    });
    if (!b) throw new NotFoundException('building not found');
    return b.id;
  }

  async list(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const items = await this.prisma.qrLocation.findMany({
      where: { tenantId, buildingId },
      orderBy: { code: 'asc' },
    });
    return { total: items.length, items };
  }

  async create(tenantId: string, buildingIdOrSlug: string, body: {
    code: string; label: string; targetType: 'space' | 'equipment' | 'floor' | 'unit';
    spaceId?: string; equipmentId?: string; floorId?: string; unitId?: string; notes?: string;
  }) {
    if (!body.code || !body.label || !body.targetType) throw new BadRequestException('code, label, targetType required');
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);

    // Validate the target belongs to this building
    switch (body.targetType) {
      case 'floor': {
        if (!body.floorId) throw new BadRequestException('floorId required for targetType=floor');
        const f = await this.prisma.buildingFloor.findFirst({ where: { id: body.floorId, buildingId } });
        if (!f) throw new BadRequestException('floor not in building');
        break;
      }
      case 'unit': {
        if (!body.unitId) throw new BadRequestException('unitId required for targetType=unit');
        const u = await this.prisma.buildingUnit.findFirst({ where: { id: body.unitId, buildingId } });
        if (!u) throw new BadRequestException('unit not in building');
        break;
      }
      case 'equipment': {
        if (!body.equipmentId) throw new BadRequestException('equipmentId required for targetType=equipment');
        const e = await this.prisma.asset.findFirst({ where: { id: body.equipmentId, buildingId } });
        if (!e) throw new BadRequestException('equipment not in building');
        break;
      }
      case 'space': {
        // No generic space table yet; accept spaceId as free string.
        if (!body.spaceId) throw new BadRequestException('spaceId required for targetType=space');
        break;
      }
    }

    try {
      return await this.prisma.qrLocation.create({
        data: {
          tenantId, buildingId,
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
      target = await this.prisma.buildingUnit.findUnique({ where: { id: row.unitId }, include: { floor: { select: { floorCode: true, floorNumber: true } } } });
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
