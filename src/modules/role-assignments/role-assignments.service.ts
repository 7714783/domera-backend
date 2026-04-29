// INIT-013 — Primary owner of TeamMemberRoleAssignment.
//
// Handles assign / scope edit / revoke / list-by-member /
// list-by-role / findEligibleAssignees(taskKind, contextScope).
//
// The auto-routing resolver is the load-bearing public API consumed by
// PPM / Cleaning / Reactive: when a new task is created and the
// caller does not provide a defaultAssignee, the resolver finds members
// whose role-permission set covers the task and whose ABAC scope
// intersects the task context. The strategy = least-loaded by default.

import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const SCOPE_RANK: Record<string, number> = {
  project: 1,
  building: 2,
  organization: 3,
  workspace: 4,
};

export interface AssignmentCreate {
  teamMemberId: string;
  roleKey: string;
  buildingIds?: string[];
  floorIds?: string[];
  zoneIds?: string[];
  systemIds?: string[];
  teamId?: string | null;
  contractorCompanyId?: string | null;
  tenantCompanyId?: string | null;
  createdByScope?: boolean;
  expiresAt?: string | null;
}

export type AssignmentUpdate = Partial<Omit<AssignmentCreate, 'teamMemberId' | 'roleKey'>>;

export interface FindEligibleArgs {
  // Permission needed to handle this task type, e.g. 'ppm.handle' or
  // 'cleaning.complete_soft_services' or 'incident.handle'.
  requiredPermission: string;
  buildingId?: string;
  floorId?: string;
  zoneId?: string;
  systemId?: string;
  // 'least_loaded' (default), 'first', or 'round_robin'.
  strategy?: 'least_loaded' | 'first' | 'round_robin';
  // open-task counter for 'least_loaded' — caller passes the live count
  // map { teamMemberId → openTasks }. If omitted, we treat all as 0.
  openTaskLoad?: Record<string, number>;
}

@Injectable()
export class RoleAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // List all active grants in a workspace (optionally narrowed by member
  // or by role).
  async list(
    tenantId: string,
    opts: { teamMemberId?: string; roleKey?: string; activeOnly?: boolean } = {},
  ) {
    const where: any = { tenantId };
    if (opts.teamMemberId) where.teamMemberId = opts.teamMemberId;
    if (opts.roleKey) where.roleKey = opts.roleKey;
    if (opts.activeOnly !== false) {
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }];
    }
    const items = await (this.prisma as any).teamMemberRoleAssignment.findMany({
      where,
      include: {
        teamMember: { select: { id: true, displayName: true, kind: true, isActive: true } },
        role: { select: { key: true, name: true, scope: true, isCustom: true, categories: true } },
      },
      orderBy: [{ delegatedAt: 'desc' }],
    });
    return { total: items.length, items };
  }

  // Verify that the actor has permission to delegate this role. Logic
  // mirrors IamService.canDelegate but reads from TeamMemberRoleAssignment.
  async canDelegate(
    tenantId: string,
    actorUserId: string,
    targetRoleKey: string,
  ): Promise<boolean> {
    const actorMember = await (this.prisma as any).teamMember.findFirst({
      where: { tenantId, userId: actorUserId, isActive: true },
    });
    if (!actorMember) return false;
    const grants = await (this.prisma as any).teamMemberRoleAssignment.findMany({
      where: {
        tenantId,
        teamMemberId: actorMember.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: { role: true },
    });
    if (!grants.length) {
      // Single-member rule: if exactly one ACTIVE member exists and it's
      // the actor, allow anything (workspace bootstrap).
      const total = await (this.prisma as any).teamMember.count({
        where: { tenantId, isActive: true },
      });
      if (total === 1 && actorMember.id) return true;
      return false;
    }
    const target = await this.prisma.role.findUnique({ where: { key: targetRoleKey } });
    if (!target) throw new NotFoundException(`role not found: ${targetRoleKey}`);
    const targetRank = SCOPE_RANK[target.scope] ?? 0;
    for (const g of grants) {
      const max = g.role.maxDelegatableScope;
      if (!max) continue;
      const ownRank = SCOPE_RANK[g.role.scope] ?? 0;
      const maxRank = SCOPE_RANK[max] ?? 0;
      if (targetRank <= maxRank && targetRank <= ownRank) return true;
    }
    return false;
  }

  async assign(tenantId: string, actorUserId: string, body: AssignmentCreate) {
    const member = await (this.prisma as any).teamMember.findFirst({
      where: { id: body.teamMemberId, tenantId },
    });
    if (!member) throw new NotFoundException('team member not found');
    if (!member.isActive) throw new BadRequestException('cannot assign role to inactive member');

    const role = await this.prisma.role.findUnique({ where: { key: body.roleKey } });
    if (!role) throw new NotFoundException(`role not found: ${body.roleKey}`);
    if (role.tenantId && role.tenantId !== tenantId) {
      throw new ForbiddenException('role belongs to another tenant');
    }

    const ok = await this.canDelegate(tenantId, actorUserId, body.roleKey);
    if (!ok) throw new ForbiddenException('actor cannot delegate this role');

    const existing = await (this.prisma as any).teamMemberRoleAssignment.findUnique({
      where: {
        teamMemberId_roleKey: { teamMemberId: body.teamMemberId, roleKey: body.roleKey },
      },
    });
    if (existing) {
      throw new ConflictException('this role is already assigned to this member; edit instead');
    }

    const created = await (this.prisma as any).teamMemberRoleAssignment.create({
      data: {
        tenantId,
        teamMemberId: body.teamMemberId,
        roleKey: body.roleKey,
        buildingIds: body.buildingIds ?? [],
        floorIds: body.floorIds ?? [],
        zoneIds: body.zoneIds ?? [],
        systemIds: body.systemIds ?? [],
        teamId: body.teamId ?? null,
        contractorCompanyId: body.contractorCompanyId ?? null,
        tenantCompanyId: body.tenantCompanyId ?? null,
        createdByScope: body.createdByScope ?? false,
        delegatedBy: actorUserId,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });

    await this.audit.write({
      tenantId,
      buildingId: null,
      actor: actorUserId,
      role: 'delegator',
      action: 'role.assigned',
      entity: created.id,
      entityType: 'role_assignment',
      building: '',
      ip: '127.0.0.1',
      sensitive: true,
      eventType: 'role.assigned',
      resourceType: 'role_assignment',
      resourceId: created.id,
      metadata: {
        teamMemberId: body.teamMemberId,
        roleKey: body.roleKey,
        scopeNarrowed:
          (body.buildingIds?.length ?? 0) +
            (body.floorIds?.length ?? 0) +
            (body.zoneIds?.length ?? 0) +
            (body.systemIds?.length ?? 0) >
          0,
      },
    });
    return created;
  }

  async update(tenantId: string, actorUserId: string, id: string, body: AssignmentUpdate) {
    const existing = await (this.prisma as any).teamMemberRoleAssignment.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('assignment not found');
    const ok = await this.canDelegate(tenantId, actorUserId, existing.roleKey);
    if (!ok) throw new ForbiddenException('actor cannot edit this assignment');

    const data: any = {};
    if (body.buildingIds !== undefined) data.buildingIds = body.buildingIds;
    if (body.floorIds !== undefined) data.floorIds = body.floorIds;
    if (body.zoneIds !== undefined) data.zoneIds = body.zoneIds;
    if (body.systemIds !== undefined) data.systemIds = body.systemIds;
    if (body.teamId !== undefined) data.teamId = body.teamId;
    if (body.contractorCompanyId !== undefined) data.contractorCompanyId = body.contractorCompanyId;
    if (body.tenantCompanyId !== undefined) data.tenantCompanyId = body.tenantCompanyId;
    if (body.createdByScope !== undefined) data.createdByScope = body.createdByScope;
    if (body.expiresAt !== undefined) {
      data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    }

    const updated = await (this.prisma as any).teamMemberRoleAssignment.update({
      where: { id: existing.id },
      data,
    });

    await this.audit.write({
      tenantId,
      buildingId: null,
      actor: actorUserId,
      role: 'delegator',
      action: 'role.scope_updated',
      entity: updated.id,
      entityType: 'role_assignment',
      building: '',
      ip: '127.0.0.1',
      sensitive: true,
      eventType: 'role.updated',
      resourceType: 'role_assignment',
      resourceId: updated.id,
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  }

  async revoke(tenantId: string, actorUserId: string, id: string) {
    const existing = await (this.prisma as any).teamMemberRoleAssignment.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('assignment not found');
    const ok = await this.canDelegate(tenantId, actorUserId, existing.roleKey);
    if (!ok) throw new ForbiddenException('actor cannot revoke this assignment');
    await (this.prisma as any).teamMemberRoleAssignment.delete({ where: { id: existing.id } });
    await this.audit.write({
      tenantId,
      buildingId: null,
      actor: actorUserId,
      role: 'delegator',
      action: 'role.revoked',
      entity: existing.id,
      entityType: 'role_assignment',
      building: '',
      ip: '127.0.0.1',
      sensitive: true,
      eventType: 'role.revoked',
      resourceType: 'role_assignment',
      resourceId: existing.id,
      metadata: { roleKey: existing.roleKey, teamMemberId: existing.teamMemberId },
    });
    return { ok: true };
  }

  // ── Auto-routing resolver ────────────────────────────────────────
  //
  // Returns the list of TeamMember rows eligible to be assigned a task
  // matching the given criteria. Caller picks one based on the
  // strategy. Empty array = no eligible member; the caller is expected
  // to fall back to the unassigned queue + alert.
  async findEligibleAssignees(tenantId: string, args: FindEligibleArgs) {
    // Find every (assignment, role-permissions) tuple that holds the
    // required permission. We grab everything in one query and intersect
    // scope in JS — simpler than crafting a JOIN expression for ABAC.
    const rows = await (this.prisma as any).teamMemberRoleAssignment.findMany({
      where: {
        tenantId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        teamMember: { isActive: true },
        role: { permissions: { some: { permission: args.requiredPermission } } },
      },
      include: {
        teamMember: { select: { id: true, displayName: true, kind: true } },
      },
    });

    // Intersect ABAC scope. Empty array = unrestricted within parent.
    function intersects(allowed: string[], requested: string | undefined): boolean {
      if (!allowed || allowed.length === 0) return true;
      if (!requested) return false;
      return allowed.includes(requested);
    }

    const eligible = rows.filter(
      (r: any) =>
        intersects(r.buildingIds, args.buildingId) &&
        intersects(r.floorIds, args.floorId) &&
        intersects(r.zoneIds, args.zoneId) &&
        intersects(r.systemIds, args.systemId),
    );

    // Deduplicate by member id (one member may hold multiple eligible roles).
    const byMember = new Map<string, any>();
    for (const r of eligible) {
      if (!byMember.has(r.teamMemberId)) byMember.set(r.teamMemberId, r.teamMember);
    }
    const members = [...byMember.values()];

    if (args.strategy === 'first' || members.length <= 1) {
      return members;
    }
    if (args.strategy === 'round_robin') {
      // Stable rotation by id ordering — caller is responsible for
      // tracking last-assigned externally if true RR is needed.
      members.sort((a, b) => a.id.localeCompare(b.id));
      return members;
    }
    // default: least_loaded
    const load = args.openTaskLoad ?? {};
    members.sort((a, b) => (load[a.id] ?? 0) - (load[b.id] ?? 0));
    return members;
  }
}
