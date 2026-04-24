import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

// Shared building/tenant helpers. Previously duplicated across 5+ services
// (building-core, buildings, occupants, ppm, cleaning.admin). One source of
// truth keeps the authorization check uniform and avoids drift when we add
// new manager roles.

const WORKSPACE_MANAGER_ROLES = ['workspace_owner', 'workspace_admin', 'org_admin'] as const;
const BUILDING_MANAGER_ROLES = ['building_manager', 'chief_engineer'] as const;

export async function requireManager(
  prisma: PrismaService,
  tenantId: string,
  actorUserId: string,
  opts?: { buildingId?: string; extraBuildingRoles?: string[] },
): Promise<void> {
  const ws = await prisma.membership.findFirst({
    where: { tenantId, userId: actorUserId, roleKey: { in: [...WORKSPACE_MANAGER_ROLES] } },
    select: { id: true },
  });
  if (ws) return;

  const buildingRoles = [...BUILDING_MANAGER_ROLES, ...(opts?.extraBuildingRoles ?? [])];
  const br = await prisma.buildingRoleAssignment.findFirst({
    where: {
      tenantId,
      userId: actorUserId,
      roleKey: { in: buildingRoles },
      ...(opts?.buildingId ? { buildingId: opts.buildingId } : {}),
    },
    select: { id: true },
  });
  if (!br) throw new ForbiddenException('not authorized');
}

export async function resolveBuildingId(
  prisma: PrismaService,
  tenantId: string,
  idOrSlug: string,
): Promise<string> {
  const byId = await prisma.building.findFirst({
    where: { id: idOrSlug, tenantId },
    select: { id: true },
  });
  if (byId) return byId.id;
  const bySlug = await prisma.building.findUnique({
    where: { tenantId_slug: { tenantId, slug: idOrSlug } },
    select: { id: true },
  });
  if (!bySlug) throw new NotFoundException('building not found');
  return bySlug.id;
}
