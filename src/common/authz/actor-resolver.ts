// INIT-007 Phase 3 — ActorResolver.
//
// Given a userId + tenantId (+ optional buildingId for scope narrowing),
// assemble the Actor object used by the policy engine. Called at the start
// of every protected request in tenant-scoped controllers.
//
// Strategy: one query for Role grants (Membership + BuildingRoleAssignment
// filtered by tenantId/buildingId), one query for that role's permissions.
// Result cached per-request in AsyncLocalStorage via TenantContext — but
// intentionally NOT cached across requests for now, so role changes take
// effect immediately (no stale authzVersion problem until we need it).

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Actor, Scope } from './types';

@Injectable()
export class ActorResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(params: {
    userId: string;
    tenantId: string;
    buildingId?: string;
    isSuperAdmin?: boolean;
    mfaLevel?: 'none' | 'password' | 'mfa';
  }): Promise<Actor> {
    const { userId, tenantId, buildingId, isSuperAdmin, mfaLevel } = params;

    const [memberships, buildingGrants] = await Promise.all([
      this.prisma.membership.findMany({
        where: { userId, tenantId, status: 'active' },
        select: { roleKey: true },
      }),
      this.prisma.buildingRoleAssignment.findMany({
        where: {
          userId,
          tenantId,
          ...(buildingId ? { buildingId } : {}),
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: {
          roleKey: true,
          buildingId: true,
          floorIds: true,
          zoneIds: true,
          systemIds: true,
          teamId: true,
          contractorCompanyId: true,
          tenantCompanyId: true,
          createdByScope: true,
        },
      }),
    ]);

    const roleKeys = new Set<string>();
    for (const m of memberships) roleKeys.add(m.roleKey);
    for (const g of buildingGrants) roleKeys.add(g.roleKey);

    const permRows = roleKeys.size
      ? await this.prisma.rolePermission.findMany({
          where: { roleKey: { in: [...roleKeys] } },
          select: { permission: true },
        })
      : [];
    const permissions = new Set(permRows.map((p) => p.permission));

    // Scope aggregation — most restrictive WIN when multiple grants would
    // constrain the same dimension, because the guards are AND-of-all.
    // Today we take the union across grants (least restrictive) because
    // most users only have one grant; multi-grant merging is deferred.
    const scope: Scope = {
      tenantId,
      buildingIds: buildingId ? [buildingId] : buildingGrants.map((g) => g.buildingId),
      floorIds: mergeStringArrays(buildingGrants.map((g) => g.floorIds)),
      zoneIds: mergeStringArrays(buildingGrants.map((g) => g.zoneIds)),
      systemIds: mergeStringArrays(buildingGrants.map((g) => g.systemIds)),
      teamId: firstNonNull(buildingGrants.map((g) => g.teamId)),
      contractorCompanyId: firstNonNull(buildingGrants.map((g) => g.contractorCompanyId)),
      tenantCompanyId: firstNonNull(buildingGrants.map((g) => g.tenantCompanyId)),
      createdByScope: buildingGrants.some((g) => g.createdByScope === true),
    };

    // Pick the most privileged role as activeRole for UI hints. Not used
    // by guards — guards only look at `permissions` + `scope`.
    const activeRole = pickPrincipalRole([...roleKeys]);

    return {
      userId,
      activeRole,
      permissions,
      scope,
      authzVersion: 1,
      mfaLevel: mfaLevel ?? 'password',
      isSuperAdmin: !!isSuperAdmin,
    };
  }
}

/** Merge multiple string[] lists. Empty array = unrestricted, so if any
 *  grant is unrestricted, the merged result is unrestricted (empty). */
function mergeStringArrays(lists: string[][]): string[] {
  if (lists.some((l) => !l || l.length === 0)) return [];
  const union = new Set<string>();
  for (const l of lists) for (const v of l) union.add(v);
  return [...union];
}

function firstNonNull(values: (string | null | undefined)[]): string | null {
  for (const v of values) if (v) return v;
  return null;
}

const ROLE_PRIORITY = [
  'workspace_owner',
  'workspace_admin',
  'org_admin',
  'building_manager',
  'chief_engineer',
  'maintenance_coordinator',
  'technician',
  'cleaner',
  'contractor',
  'viewer',
];

function pickPrincipalRole(roles: string[]): string {
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r;
  return roles[0] ?? 'viewer';
}
