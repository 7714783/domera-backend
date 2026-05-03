// INIT-012 NS-15 — building-spaces module owns BuildingSpace +
// BuildingElement (both seeded by NS-14 schema 023). These tables
// hold the structural details that live OUTSIDE the unit grid:
// BuildingSpace = enclosed serviceable areas (mechanical rooms,
// restrooms, lobbies, storage, parking_zone) that are bookable +
// inspectable + QR-taggable. BuildingElement = structural details
// that cannot be "occupied" but require maintenance (roof, basement,
// façade, doors, gardens). Manager-gated; tenant-scoped via prisma
// auto-RLS wrapper (tenantId on every where clause).

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { requireManager, resolveBuildingId } from '../../common/building.helpers';

const SPACE_TYPES = [
  'mechanical_room',
  'restroom',
  'lobby',
  'storage',
  'utility',
  'parking_zone',
  'other',
] as const;
const ELEMENT_TYPES = [
  'roof',
  'basement',
  'facade',
  'door',
  'window',
  'garden',
  'parking_lot',
  'other',
] as const;
const CONDITION_STATES = ['good', 'fair', 'poor', 'critical'] as const;

@Injectable()
export class BuildingSpacesService {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager = (tenantId: string, actorUserId: string) =>
    requireManager(this.prisma, tenantId, actorUserId);
  private resolveBuildingId = (tenantId: string, idOrSlug: string) =>
    resolveBuildingId(this.prisma, tenantId, idOrSlug);

  // ── Spaces ──────────────────────────────────────────
  async listSpaces(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingSpace.findMany({
      where: { tenantId, buildingId },
      orderBy: [{ spaceType: 'asc' }, { code: 'asc' }],
    });
  }

  async createSpace(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      code: string;
      name: string;
      spaceType: string;
      floorId?: string | null;
      areaSqm?: number | null;
      isShared?: boolean;
      isBookable?: boolean;
      qrLocationId?: string | null;
      notes?: string | null;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body?.code || !body?.name || !body?.spaceType) {
      throw new BadRequestException('code, name, spaceType required');
    }
    if (!SPACE_TYPES.includes(body.spaceType as any)) {
      throw new BadRequestException(`spaceType must be one of: ${SPACE_TYPES.join(', ')}`);
    }
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const conflict = await this.prisma.buildingSpace.findFirst({
      where: { tenantId, buildingId, code: body.code },
      select: { id: true },
    });
    if (conflict) throw new BadRequestException(`space code "${body.code}" already exists`);
    return this.prisma.buildingSpace.create({
      data: {
        tenantId,
        buildingId,
        code: body.code,
        name: body.name,
        spaceType: body.spaceType,
        floorId: body.floorId ?? null,
        areaSqm: body.areaSqm ?? null,
        isShared: body.isShared ?? true,
        isBookable: body.isBookable ?? false,
        qrLocationId: body.qrLocationId ?? null,
        notes: body.notes ?? null,
        createdBy: `user:${actorUserId}`,
      },
    });
  }

  async updateSpace(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    spaceId: string,
    body: Partial<{
      name: string;
      spaceType: string;
      floorId: string | null;
      areaSqm: number | null;
      isShared: boolean;
      isBookable: boolean;
      qrLocationId: string | null;
      notes: string | null;
    }>,
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const existing = await this.prisma.buildingSpace.findFirst({
      where: { tenantId, id: spaceId, buildingId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('space not found');
    if (body.spaceType && !SPACE_TYPES.includes(body.spaceType as any)) {
      throw new BadRequestException(`spaceType must be one of: ${SPACE_TYPES.join(', ')}`);
    }
    return this.prisma.buildingSpace.update({
      where: { id: spaceId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.spaceType !== undefined ? { spaceType: body.spaceType } : {}),
        ...(body.floorId !== undefined ? { floorId: body.floorId } : {}),
        ...(body.areaSqm !== undefined ? { areaSqm: body.areaSqm } : {}),
        ...(body.isShared !== undefined ? { isShared: body.isShared } : {}),
        ...(body.isBookable !== undefined ? { isBookable: body.isBookable } : {}),
        ...(body.qrLocationId !== undefined ? { qrLocationId: body.qrLocationId } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });
  }

  async deleteSpace(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    spaceId: string,
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const existing = await this.prisma.buildingSpace.findFirst({
      where: { tenantId, id: spaceId, buildingId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('space not found');
    await this.prisma.buildingSpace.delete({ where: { id: spaceId } });
    return { ok: true };
  }

  // ── Elements ────────────────────────────────────────
  async listElements(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    return this.prisma.buildingElement.findMany({
      where: { tenantId, buildingId },
      orderBy: [{ elementType: 'asc' }, { code: 'asc' }],
    });
  }

  async createElement(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      code: string;
      name: string;
      elementType: string;
      material?: string | null;
      installedAt?: string | null;
      warrantyEnd?: string | null;
      conditionState?: string;
      notes?: string | null;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    if (!body?.code || !body?.name || !body?.elementType) {
      throw new BadRequestException('code, name, elementType required');
    }
    if (!ELEMENT_TYPES.includes(body.elementType as any)) {
      throw new BadRequestException(`elementType must be one of: ${ELEMENT_TYPES.join(', ')}`);
    }
    if (body.conditionState && !CONDITION_STATES.includes(body.conditionState as any)) {
      throw new BadRequestException(
        `conditionState must be one of: ${CONDITION_STATES.join(', ')}`,
      );
    }
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const conflict = await this.prisma.buildingElement.findFirst({
      where: { tenantId, buildingId, code: body.code },
      select: { id: true },
    });
    if (conflict) throw new BadRequestException(`element code "${body.code}" already exists`);
    return this.prisma.buildingElement.create({
      data: {
        tenantId,
        buildingId,
        code: body.code,
        name: body.name,
        elementType: body.elementType,
        material: body.material ?? null,
        installedAt: body.installedAt ? new Date(body.installedAt) : null,
        warrantyEnd: body.warrantyEnd ? new Date(body.warrantyEnd) : null,
        conditionState: body.conditionState ?? 'good',
        notes: body.notes ?? null,
        createdBy: `user:${actorUserId}`,
      },
    });
  }

  async updateElement(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    elementId: string,
    body: Partial<{
      name: string;
      elementType: string;
      material: string | null;
      installedAt: string | null;
      warrantyEnd: string | null;
      conditionState: string;
      notes: string | null;
    }>,
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const existing = await this.prisma.buildingElement.findFirst({
      where: { tenantId, id: elementId, buildingId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('element not found');
    if (body.elementType && !ELEMENT_TYPES.includes(body.elementType as any)) {
      throw new BadRequestException(`elementType must be one of: ${ELEMENT_TYPES.join(', ')}`);
    }
    if (body.conditionState && !CONDITION_STATES.includes(body.conditionState as any)) {
      throw new BadRequestException(
        `conditionState must be one of: ${CONDITION_STATES.join(', ')}`,
      );
    }
    return this.prisma.buildingElement.update({
      where: { id: elementId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.elementType !== undefined ? { elementType: body.elementType } : {}),
        ...(body.material !== undefined ? { material: body.material } : {}),
        ...(body.installedAt !== undefined
          ? { installedAt: body.installedAt ? new Date(body.installedAt) : null }
          : {}),
        ...(body.warrantyEnd !== undefined
          ? { warrantyEnd: body.warrantyEnd ? new Date(body.warrantyEnd) : null }
          : {}),
        ...(body.conditionState !== undefined ? { conditionState: body.conditionState } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });
  }

  async deleteElement(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    elementId: string,
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const existing = await this.prisma.buildingElement.findFirst({
      where: { tenantId, id: elementId, buildingId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('element not found');
    await this.prisma.buildingElement.delete({ where: { id: elementId } });
    return { ok: true };
  }

  // Counts only — surfaced by Building Passport "Layout" card.
  async counts(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const [spaces, elements] = await Promise.all([
      this.prisma.buildingSpace.count({ where: { tenantId, buildingId } }),
      this.prisma.buildingElement.count({ where: { tenantId, buildingId } }),
    ]);
    return { spaces, elements };
  }
}
