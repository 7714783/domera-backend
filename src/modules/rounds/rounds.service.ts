import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RoundsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, buildingId?: string) {
    const where: any = { tenantId };
    if (buildingId) where.buildingId = buildingId;
    const rounds = await this.prisma.round.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: { waypoints: { orderBy: { orderNo: 'asc' } } },
    });
    return rounds.map((r) => ({
      ...r,
      waypointCount: r.waypoints.length,
    }));
  }

  async get(tenantId: string, id: string) {
    const r = await this.prisma.round.findFirst({
      where: { id, tenantId },
      include: { waypoints: { orderBy: { orderNo: 'asc' } } },
    });
    if (!r) throw new NotFoundException('round not found');
    return r;
  }

  async create(tenantId: string, actorUserId: string, body: {
    buildingId: string; name: string; description?: string;
    recurrenceRule?: string; assignedRole?: string; estimatedMinutes?: number;
    waypoints?: Array<{
      label: string; orderNo?: number;
      locationId?: string; unitId?: string; legacyZoneId?: string;
      documentTemplateId?: string;
      requiresPhoto?: boolean; requiresSignature?: boolean;
      expectedDurationMinutes?: number; notes?: string;
    }>;
  }) {
    if (!body.buildingId || !body.name) throw new BadRequestException('buildingId and name required');
    const round = await this.prisma.round.create({
      data: {
        tenantId, buildingId: body.buildingId,
        name: body.name, description: body.description || null,
        recurrenceRule: body.recurrenceRule || null,
        assignedRole: body.assignedRole || null,
        estimatedMinutes: body.estimatedMinutes ?? null,
        createdByUserId: actorUserId,
      },
    });
    if (body.waypoints && body.waypoints.length > 0) {
      let n = 1;
      for (const w of body.waypoints) {
        await this.prisma.roundWaypoint.create({
          data: {
            tenantId, roundId: round.id,
            orderNo: w.orderNo ?? n++,
            label: w.label,
            locationId: w.locationId || null,
            unitId: w.unitId || null,
            legacyZoneId: w.legacyZoneId || null,
            documentTemplateId: w.documentTemplateId || null,
            requiresPhoto: !!w.requiresPhoto,
            requiresSignature: !!w.requiresSignature,
            expectedDurationMinutes: w.expectedDurationMinutes ?? null,
            notes: w.notes || null,
          },
        });
      }
    }
    return this.get(tenantId, round.id);
  }

  async update(tenantId: string, id: string, body: Partial<{
    name: string; description: string; recurrenceRule: string | null;
    assignedRole: string | null; estimatedMinutes: number | null; isActive: boolean;
  }>) {
    const r = await this.prisma.round.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('round not found');
    return this.prisma.round.update({ where: { id }, data: body });
  }

  async addWaypoint(tenantId: string, roundId: string, body: {
    label: string; orderNo?: number;
    locationId?: string; unitId?: string; legacyZoneId?: string;
    documentTemplateId?: string;
    requiresPhoto?: boolean; requiresSignature?: boolean;
    expectedDurationMinutes?: number; notes?: string;
  }) {
    const r = await this.prisma.round.findFirst({ where: { id: roundId, tenantId } });
    if (!r) throw new NotFoundException('round not found');
    if (!body.label) throw new BadRequestException('label required');
    let orderNo = body.orderNo;
    if (orderNo === undefined || orderNo === null) {
      const last = await this.prisma.roundWaypoint.findFirst({
        where: { roundId }, orderBy: { orderNo: 'desc' }, select: { orderNo: true },
      });
      orderNo = (last?.orderNo ?? 0) + 1;
    }
    return this.prisma.roundWaypoint.create({
      data: {
        tenantId, roundId,
        orderNo, label: body.label,
        locationId: body.locationId || null,
        unitId: body.unitId || null,
        legacyZoneId: body.legacyZoneId || null,
        documentTemplateId: body.documentTemplateId || null,
        requiresPhoto: !!body.requiresPhoto,
        requiresSignature: !!body.requiresSignature,
        expectedDurationMinutes: body.expectedDurationMinutes ?? null,
        notes: body.notes || null,
      },
    });
  }

  async deleteWaypoint(tenantId: string, waypointId: string) {
    const w = await this.prisma.roundWaypoint.findFirst({ where: { id: waypointId, tenantId } });
    if (!w) throw new NotFoundException('waypoint not found');
    await this.prisma.roundWaypoint.delete({ where: { id: waypointId } });
    return { ok: true };
  }

  async delete(tenantId: string, id: string) {
    const r = await this.prisma.round.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('round not found');
    await this.prisma.round.delete({ where: { id } });
    return { ok: true };
  }
}
