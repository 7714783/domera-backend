// INIT-013 — TeamMember owner. Single source of people inside a workspace.
//
// Three "kinds" supported:
//   · 'employee'   — has a User account in this workspace (linked via userId).
//   · 'contractor' — links to WorkspaceContractor (no User required).
//   · 'external'   — neither linked; ad-hoc human contact (auditor, vendor rep).
//
// Hard rules:
//   · No two TeamMember rows in one tenant share the same userId.
//   · Deactivation cascades — all role assignments are revoked + open task
//     ownership is reset to unassigned. The row itself stays for audit.
//   · A member with kind=contractor MUST have workspaceContractorId set.
//   · A member with kind=employee MUST have userId set.

import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export type TeamMemberKind = 'employee' | 'contractor' | 'external';

export interface TeamMemberCreate {
  kind: TeamMemberKind;
  userId?: string;
  workspaceContractorId?: string;
  displayName: string;
  email?: string;
  phone?: string;
  title?: string;
  department?: string;
  photoUrl?: string;
  startDate?: string;
}

export interface TeamMemberUpdate
  extends Partial<Omit<TeamMemberCreate, 'kind' | 'userId' | 'workspaceContractorId'>> {
  isActive?: boolean;
  endDate?: string | null;
}

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    opts: { search?: string; kind?: TeamMemberKind; activeOnly?: boolean } = {},
  ) {
    const where: any = { tenantId };
    if (opts.kind) where.kind = opts.kind;
    if (opts.activeOnly) where.isActive = true;
    if (opts.search) {
      const q = opts.search.trim();
      where.OR = [
        { displayName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
      ];
    }
    const items = await (this.prisma as any).teamMember.findMany({
      where,
      include: {
        user: { select: { id: true, displayName: true, username: true, email: true, lastLoginAt: true } },
        workspaceContractor: {
          include: { publicContractor: { select: { id: true, displayName: true, publicPhone: true } } },
        },
        roleAssignments: { include: { role: { select: { key: true, name: true, scope: true, categories: true } } } },
      },
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
    });
    return { total: items.length, items };
  }

  async getOne(tenantId: string, id: string) {
    const r = await (this.prisma as any).teamMember.findFirst({
      where: { id, tenantId },
      include: {
        user: true,
        workspaceContractor: { include: { publicContractor: true } },
        roleAssignments: {
          include: { role: { include: { permissions: true } } },
          orderBy: { delegatedAt: 'desc' },
        },
      },
    });
    if (!r) throw new NotFoundException('team member not found');
    return r;
  }

  async create(tenantId: string, actor: string, body: TeamMemberCreate) {
    if (!body.displayName?.trim()) throw new BadRequestException('displayName required');
    if (body.kind === 'employee' && !body.userId)
      throw new BadRequestException('userId required for employee kind');
    if (body.kind === 'contractor' && !body.workspaceContractorId)
      throw new BadRequestException('workspaceContractorId required for contractor kind');

    if (body.userId) {
      const dup = await (this.prisma as any).teamMember.findFirst({
        where: { tenantId, userId: body.userId },
      });
      if (dup) throw new ConflictException('user already linked to a team member in this workspace');
    }

    const created = await (this.prisma as any).teamMember.create({
      data: {
        tenantId,
        kind: body.kind,
        userId: body.userId ?? null,
        workspaceContractorId: body.workspaceContractorId ?? null,
        displayName: body.displayName.trim(),
        email: body.email ?? null,
        phone: body.phone ?? null,
        title: body.title ?? null,
        department: body.department ?? null,
        photoUrl: body.photoUrl ?? null,
        isActive: true,
        startDate: body.startDate ? new Date(body.startDate) : null,
      },
    });

    await this.audit.write({
      tenantId,
      buildingId: null,
      actor,
      role: 'workspace',
      action: 'team_member.added',
      entity: created.id,
      entityType: 'team_member',
      building: '',
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'team_member.created',
      resourceType: 'team_member',
      resourceId: created.id,
      metadata: { kind: created.kind },
    });
    return created;
  }

  async update(tenantId: string, actor: string, id: string, body: TeamMemberUpdate) {
    const existing = await (this.prisma as any).teamMember.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('team member not found');

    const data: any = {};
    if (body.displayName !== undefined) data.displayName = body.displayName;
    if (body.email !== undefined) data.email = body.email;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.title !== undefined) data.title = body.title;
    if (body.department !== undefined) data.department = body.department;
    if (body.photoUrl !== undefined) data.photoUrl = body.photoUrl;
    if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.endDate !== undefined) data.endDate = body.endDate ? new Date(body.endDate) : null;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    const updated = await (this.prisma as any).teamMember.update({
      where: { id: existing.id },
      data,
    });

    await this.audit.write({
      tenantId,
      buildingId: null,
      actor,
      role: 'workspace',
      action: 'team_member.updated',
      entity: updated.id,
      entityType: 'team_member',
      building: '',
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'team_member.updated',
      resourceType: 'team_member',
      resourceId: updated.id,
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  }

  // Deactivate cascade: revoke ALL role assignments first, then mark inactive.
  // The row stays for audit history. Open tasks are NOT auto-reassigned by
  // this service — that's a follow-up via the resolver, run by a job.
  async deactivate(tenantId: string, actor: string, id: string) {
    const existing = await (this.prisma as any).teamMember.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('team member not found');

    const grants = await (this.prisma as any).teamMemberRoleAssignment.findMany({
      where: { tenantId, teamMemberId: id },
    });

    const now = new Date();
    await (this.prisma as any).teamMemberRoleAssignment.updateMany({
      where: { tenantId, teamMemberId: id, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { expiresAt: now },
    });

    const updated = await (this.prisma as any).teamMember.update({
      where: { id: existing.id },
      data: { isActive: false, endDate: now },
    });

    await this.audit.transition({
      tenantId,
      actor,
      actorRole: 'workspace',
      entityType: 'team_member',
      entityId: updated.id,
      from: 'active',
      to: 'inactive',
      sensitive: true,
      metadata: { revokedGrants: grants.length },
    });
    return { ok: true, revokedGrants: grants.length };
  }

  // Helper for the auto-routing resolver — used by other modules.
  async findById(tenantId: string, id: string) {
    return (this.prisma as any).teamMember.findFirst({ where: { id, tenantId } });
  }

  // INIT-013 — single-member rule. When the workspace has exactly one
  // ACTIVE team member, callers can treat that member as having all
  // permissions implicitly (workspace_owner). Lets the very first user
  // bootstrap the workspace without having to grant every role.
  async isSoleActiveMember(tenantId: string, teamMemberId: string): Promise<boolean> {
    const total = await (this.prisma as any).teamMember.count({
      where: { tenantId, isActive: true },
    });
    if (total !== 1) return false;
    const me = await (this.prisma as any).teamMember.findFirst({
      where: { id: teamMemberId, tenantId, isActive: true },
    });
    return !!me;
  }
}
