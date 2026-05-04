import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxRegistry } from '../events/outbox.registry';

const SCOPE_RANK: Record<string, number> = {
  project: 1,
  building: 2,
  organization: 3,
  workspace: 4,
};

@Injectable()
export class IamService implements OnModuleInit {
  private readonly inviteLog = new Logger('IamService.invite');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outboxRegistry: OutboxRegistry,
  ) {}

  // GROWTH-001 NS-21 — subscribe to invite.accepted.
  //
  // The invites module marks the row accepted synchronously (so a token
  // can't double-spend) and emits invite.accepted via the outbox. This
  // handler is the consumer: it ensures a User row exists for the
  // invitee email and that they have a Membership in the inviting
  // tenant with the granted role.
  //
  // Idempotent — at-least-once delivery means a process restart can
  // replay the same event. Dedup key is (tenantId, user.id, roleKey)
  // via the existing unique index on memberships.
  //
  // Out of scope for v1: BuildingRoleAssignment grants for
  // payload.buildingIds (ABAC scope). The membership row gives the
  // user workspace-level role; building-scoped grants come in a
  // follow-up when team-and-roles wiring is more mature.
  onModuleInit() {
    this.outboxRegistry.register('invite.accepted', async (event) => {
      const payload = (event.payload || {}) as Record<string, any>;
      const tenantId: string | undefined = payload.tenantId;
      const email: string | undefined = payload.email;
      const roleKey: string | undefined = payload.roleKey;
      const inviteId: string | undefined = payload.inviteId;
      const fullName: string | undefined = payload.fullName ?? undefined;
      const password: string | undefined = payload.password ?? undefined;

      if (!tenantId || !email || !roleKey || !inviteId) {
        this.inviteLog.warn(
          `invite.accepted ${event.id}: missing required payload fields — skipping`,
        );
        return;
      }

      try {
        // 1. Find or create the User row by emailNormalized (the canonical
        //    UNIQUE column). Cross-tenant invites with the same email
        //    target the SAME user record (intentional — one human, many
        //    workspace memberships).
        const lower = email.toLowerCase();
        const existingUser = await this.prisma.user.findUnique({
          where: { emailNormalized: lower },
          select: { id: true, displayName: true },
        });

        let userId: string;
        if (existingUser) {
          userId = existingUser.id;
          // Backfill displayName if it was previously empty.
          if (fullName && !existingUser.displayName) {
            await this.prisma.user.update({
              where: { id: userId },
              data: { displayName: fullName },
            });
          }
        } else {
          // New user: bcrypt the password if provided; otherwise leave
          // the column null so the user has to use a "set password"
          // flow later. (Auth login refuses null-passwordHash users.)
          const passwordHash = password ? await bcrypt.hash(password, 12) : null;
          const created = await this.prisma.user.create({
            data: {
              email: lower,
              emailNormalized: lower,
              displayName: fullName || lower,
              passwordHash,
              status: 'active',
            },
            select: { id: true },
          });
          userId = created.id;
        }

        // 2. Idempotent Membership insert. Composite UNIQUE on
        //    (tenantId, userId, roleKey) prevents duplicates if the
        //    handler retries.
        const existingMembership = await this.prisma.membership.findFirst({
          where: { tenantId, userId, roleKey },
          select: { id: true },
        });
        if (!existingMembership) {
          await this.prisma.membership.create({
            data: {
              tenantId,
              userId,
              roleKey,
              status: 'active',
            },
          });
        }

        // 3. Update the invite row with acceptedByUserId so the inviter
        //    sees who actually consumed the token. The invites module
        //    already flipped status='accepted' before publishing — we
        //    just enrich the row.
        await this.prisma.invite.update({
          where: { id: inviteId },
          data: { acceptedByUserId: userId },
        });

        await this.audit.write({
          tenantId,
          actor: 'invite.accepted-handler',
          role: 'system',
          action: 'membership.created-from-invite',
          entity: userId,
          entityType: 'membership',
          building: '',
          ip: '',
          sensitive: false,
          eventType: 'membership.created',
          metadata: { inviteId, email: lower, roleKey },
        });
      } catch (err) {
        this.inviteLog.warn(
          `invite.accepted ${event.id}: handler failed — ${(err as Error).message}`,
        );
      }
    });
  }

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
