// INIT-004 Phase 2 — Assignment management service.
//
// CRUD for FloorAssignment + UserAvailability. Permission gate is the same
// requireManager() helper used by reactive / cleaning admin paths so a
// building_manager / chief_engineer / workspace_owner can manage who's
// responsible for which floor + when each staffer is off.

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { requireManager, resolveBuildingId } from '../../common/building.helpers';

const VALID_AVAILABILITY_STATUSES = ['available', 'off', 'leave', 'sick', 'absent', 'unavailable'];

@Injectable()
export class AssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  // ── FloorAssignment ────────────────────────────────────────
  async listFloorAssignments(
    tenantId: string,
    buildingIdOrSlug: string,
    filter?: { floorId?: string; roleKey?: string },
  ) {
    const buildingId = await resolveBuildingId(this.prisma, tenantId, buildingIdOrSlug);
    return this.prisma.floorAssignment.findMany({
      where: {
        tenantId,
        buildingId,
        floorId: filter?.floorId || undefined,
        roleKey: filter?.roleKey || undefined,
      },
      orderBy: [{ floorId: 'asc' }, { roleKey: 'asc' }, { primary: 'desc' }],
    });
  }

  async createFloorAssignment(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: { floorId: string; userId: string; roleKey: string; primary?: boolean },
  ) {
    if (!body.floorId || !body.userId || !body.roleKey) {
      throw new BadRequestException('floorId, userId, roleKey required');
    }
    const buildingId = await resolveBuildingId(this.prisma, tenantId, buildingIdOrSlug);
    await requireManager(this.prisma, tenantId, actorUserId, { buildingId });

    const floor = await this.prisma.buildingFloor.findFirst({
      where: { id: body.floorId, tenantId, buildingId },
    });
    if (!floor) throw new NotFoundException('floor not found in this building');

    // Enforce one primary per (floor, roleKey) — demote previous primary.
    if (body.primary) {
      await this.prisma.floorAssignment.updateMany({
        where: { tenantId, floorId: body.floorId, roleKey: body.roleKey, primary: true },
        data: { primary: false },
      });
    }

    return this.prisma.floorAssignment.upsert({
      where: {
        tenantId_floorId_userId_roleKey: {
          tenantId,
          floorId: body.floorId,
          userId: body.userId,
          roleKey: body.roleKey,
        },
      },
      update: { primary: !!body.primary, createdBy: actorUserId },
      create: {
        tenantId,
        buildingId,
        floorId: body.floorId,
        userId: body.userId,
        roleKey: body.roleKey,
        primary: !!body.primary,
        createdBy: actorUserId,
      },
    });
  }

  async deleteFloorAssignment(tenantId: string, actorUserId: string, id: string) {
    const row = await this.prisma.floorAssignment.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('floor assignment not found');
    await requireManager(this.prisma, tenantId, actorUserId, { buildingId: row.buildingId });
    await this.prisma.floorAssignment.delete({ where: { id } });
    return { ok: true };
  }

  // ── UserAvailability ───────────────────────────────────────
  async listAvailability(
    tenantId: string,
    params: { userId?: string; from?: string; to?: string },
  ) {
    const where: any = { tenantId };
    if (params.userId) where.userId = params.userId;
    if (params.from || params.to) {
      where.date = {};
      if (params.from) where.date.gte = new Date(params.from);
      if (params.to) where.date.lte = new Date(params.to);
    }
    return this.prisma.userAvailability.findMany({
      where,
      orderBy: [{ date: 'asc' }, { userId: 'asc' }],
      take: 500,
    });
  }

  async setAvailability(
    tenantId: string,
    actorUserId: string,
    body: { userId: string; date: string; status: string; reason?: string },
  ) {
    if (!body.userId || !body.date || !body.status) {
      throw new BadRequestException('userId, date, status required');
    }
    if (!VALID_AVAILABILITY_STATUSES.includes(body.status)) {
      throw new BadRequestException(
        `status must be one of ${VALID_AVAILABILITY_STATUSES.join(', ')}`,
      );
    }
    // Either the user themselves or a workspace/building manager may set
    // availability. Self-set is the common path (sick today); manager-set
    // covers approved leave or schedule planning.
    if (body.userId !== actorUserId) {
      await requireManager(this.prisma, tenantId, actorUserId);
    }

    const date = new Date(body.date);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('invalid date');
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

    return this.prisma.userAvailability.upsert({
      where: {
        tenantId_userId_date: { tenantId, userId: body.userId, date: day },
      },
      update: {
        status: body.status,
        reason: body.reason || null,
        setBy: actorUserId,
        setAt: new Date(),
      },
      create: {
        tenantId,
        userId: body.userId,
        date: day,
        status: body.status,
        reason: body.reason || null,
        setBy: actorUserId,
      },
    });
  }
}
