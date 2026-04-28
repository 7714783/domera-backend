import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const SCOPE_RANK: Record<string, number> = {
  project: 1,
  building: 2,
  organization: 3,
  workspace: 4,
};

@Injectable()
export class IamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async permissions(userId: string, buildingId: string): Promise<Set<string>> {
    const assignments = await this.prisma.buildingRoleAssignment.findMany({
      where: { userId, buildingId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { role: { include: { permissions: true } } },
    });
    const set = new Set<string>();
    for (const a of assignments) {
      for (const p of a.role.permissions) set.add(p.permission);
    }
    return set;
  }

  async canDelegate(
    actorUserId: string,
    buildingId: string,
    targetRoleKey: string,
  ): Promise<boolean> {
    const actorAssignments = await this.prisma.buildingRoleAssignment.findMany({
      where: { userId: actorUserId, buildingId },
      include: { role: true },
    });
    if (!actorAssignments.length) return false;

    const targetRole = await this.prisma.role.findUnique({ where: { key: targetRoleKey } });
    if (!targetRole) throw new NotFoundException(`role not found: ${targetRoleKey}`);

    const targetRank = SCOPE_RANK[targetRole.scope] ?? 0;
    for (const a of actorAssignments) {
      const max = a.role.maxDelegatableScope;
      if (!max) continue;
      const ownRank = SCOPE_RANK[a.role.scope] ?? 0;
      const maxRank = SCOPE_RANK[max] ?? 0;
      if (targetRank <= maxRank && targetRank <= ownRank) return true;
    }
    return false;
  }

  async assign(
    tenantId: string,
    buildingId: string,
    actorUserId: string,
    body: { userId: string; roleKey: string; expiresAt?: string | null },
  ) {
    if (body.userId === actorUserId && body.roleKey !== 'viewer') {
      throw new ForbiddenException('cannot assign higher role to self');
    }
    const ok = await this.canDelegate(actorUserId, buildingId, body.roleKey);
    if (!ok) throw new ForbiddenException('actor cannot delegate this role');

    const existing = await this.prisma.buildingRoleAssignment.findUnique({
      where: {
        buildingId_userId_roleKey: { buildingId, userId: body.userId, roleKey: body.roleKey },
      },
    });

    const result = existing
      ? await this.prisma.buildingRoleAssignment.update({
          where: { id: existing.id },
          data: {
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            delegatedBy: actorUserId,
            delegatedAt: new Date(),
          },
        })
      : await this.prisma.buildingRoleAssignment.create({
          data: {
            tenantId,
            buildingId,
            userId: body.userId,
            roleKey: body.roleKey,
            delegatedBy: actorUserId,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          },
        });

    await this.audit.write({
      tenantId,
      buildingId,
      actor: actorUserId,
      role: 'delegator',
      action: existing ? 'Role re-assigned' : 'Role assigned',
      entity: body.userId,
      entityType: 'role_assignment',
      building: buildingId,
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'role.assigned',
      resourceType: 'role_assignment',
      resourceId: result.id,
      metadata: { roleKey: body.roleKey, delegatedBy: actorUserId },
    });
    return result;
  }

  async list(tenantId: string, buildingId: string) {
    const activeNow = new Date();
    const items = await this.prisma.buildingRoleAssignment.findMany({
      where: { tenantId, buildingId, OR: [{ expiresAt: null }, { expiresAt: { gt: activeNow } }] },
      include: { role: true, user: { select: { id: true, email: true, displayName: true } } },
      orderBy: { delegatedAt: 'desc' },
    });
    return { total: items.length, items };
  }

  async createStaff(
    tenantId: string,
    buildingId: string,
    actorUserId: string,
    body: {
      displayName: string;
      email?: string;
      username?: string;
      roleKey: string;
      organizationId?: string;
      phone?: string;
      title?: string;
      password?: string;
    },
  ) {
    if (!body.displayName || !body.roleKey)
      throw new BadRequestException('displayName and roleKey required');
    const role = await this.prisma.role.findUnique({ where: { key: body.roleKey } });
    if (!role) throw new BadRequestException(`unknown role: ${body.roleKey}`);

    const canDelegate = await this.canDelegate(actorUserId, buildingId, body.roleKey);
    const actorMembership = await this.prisma.membership.findFirst({
      where: {
        tenantId,
        userId: actorUserId,
        roleKey: { in: ['workspace_owner', 'workspace_admin'] },
      },
    });
    if (!canDelegate && !actorMembership)
      throw new ForbiddenException('actor cannot assign this role');

    const baseEmail = (
      body.email ||
      `${body.displayName
        .trim()
        .toLowerCase()
        .replace(/[^\w]+/g, '.')}@staff.local`
    ).toLowerCase();
    const existingEmail = await this.prisma.user.findUnique({
      where: { emailNormalized: baseEmail },
    });
    if (existingEmail) throw new ConflictException('email already taken');

    const username = body.username?.trim();
    if (username) {
      const clash = await this.prisma.user.findUnique({ where: { username } });
      if (clash) throw new ConflictException('username already taken');
    }

    const password = body.password || 'demo-password';
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: baseEmail,
        emailNormalized: baseEmail,
        username: username || null,
        passwordHash,
        displayName: body.displayName,
        status: 'active',
        createdBy: `user:${actorUserId}`,
      },
    });

    if (body.organizationId) {
      await this.prisma.organizationMembership.create({
        data: { organizationId: body.organizationId, userId: user.id, roleKey: body.roleKey },
      });
    }

    const assignment = await this.prisma.buildingRoleAssignment.create({
      data: {
        tenantId,
        buildingId,
        userId: user.id,
        roleKey: body.roleKey,
        delegatedBy: actorUserId,
      },
    });

    await this.audit.write({
      tenantId,
      buildingId,
      actor: actorUserId,
      role: 'delegator',
      action: 'Staff member added',
      entity: user.id,
      entityType: 'user',
      building: buildingId,
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'staff.created',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { roleKey: body.roleKey, organizationId: body.organizationId || null },
    });

    return { user, assignment, temporaryPassword: body.password ? undefined : password };
  }

  async listBuildingStaff(tenantId: string, buildingId: string) {
    const assignments = await this.prisma.buildingRoleAssignment.findMany({
      where: { tenantId, buildingId },
      include: {
        role: { include: { permissions: true } },
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            displayName: true,
            isSuperAdmin: true,
            lastLoginAt: true,
            organizationMemberships: {
              include: {
                organization: { select: { id: true, name: true, slug: true, type: true } },
              },
            },
            certifications: {
              include: { certification: { select: { key: true, name: true } } },
              where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
            },
          },
        },
      },
      orderBy: { delegatedAt: 'asc' },
    });
    const grouped = new Map<
      string,
      {
        orgName: string | null;
        orgType: string | null;
        members: Array<any>;
      }
    >();
    for (const a of assignments) {
      const org = a.user.organizationMemberships[0]?.organization || null;
      const key = org ? org.id : 'unaffiliated';
      const cur = grouped.get(key) || {
        orgName: org?.name || 'Unaffiliated',
        orgType: org?.type || null,
        members: [],
      };
      cur.members.push({
        assignmentId: a.id,
        userId: a.user.id,
        displayName: a.user.displayName,
        username: a.user.username,
        email: a.user.email,
        lastLoginAt: a.user.lastLoginAt,
        roleKey: a.roleKey,
        roleName: a.role.name,
        roleScope: a.role.scope,
        permissionsCount: a.role.permissions.length,
        delegatedAt: a.delegatedAt,
        expiresAt: a.expiresAt,
        certifications: a.user.certifications.map((c) => ({
          key: c.certification.key,
          name: c.certification.name,
          expiresAt: c.expiresAt,
        })),
      });
      grouped.set(key, cur);
    }
    return {
      total: assignments.length,
      groups: [...grouped.values()],
    };
  }

  async revoke(tenantId: string, buildingId: string, actorUserId: string, assignmentId: string) {
    const existing = await this.prisma.buildingRoleAssignment.findFirst({
      where: { id: assignmentId, tenantId, buildingId },
    });
    if (!existing) throw new NotFoundException('assignment not found');
    const ok = await this.canDelegate(actorUserId, buildingId, existing.roleKey);
    if (!ok) throw new ForbiddenException('actor cannot revoke this role');
    await this.prisma.buildingRoleAssignment.delete({ where: { id: existing.id } });
    await this.audit.write({
      tenantId,
      buildingId,
      actor: actorUserId,
      role: 'delegator',
      action: 'Role revoked',
      entity: existing.userId,
      entityType: 'role_assignment',
      building: buildingId,
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'role.revoked',
      resourceType: 'role_assignment',
      resourceId: existing.id,
      metadata: { roleKey: existing.roleKey },
    });
    return { ok: true };
  }
}
