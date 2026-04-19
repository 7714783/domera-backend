import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApprovalDelegationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, actorUserId: string, body: {
    delegatorUserId: string;
    delegateUserId: string;
    role: string;
    buildingId?: string | null;
    startsAt: string;
    endsAt: string;
    reason?: string;
  }) {
    if (!body.delegatorUserId || !body.delegateUserId || !body.role) {
      throw new BadRequestException('delegatorUserId, delegateUserId, role required');
    }
    if (body.delegatorUserId === body.delegateUserId) {
      throw new BadRequestException('delegator and delegate cannot be the same user');
    }
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (!(endsAt > startsAt)) throw new BadRequestException('endsAt must be after startsAt');
    if (endsAt.getTime() - startsAt.getTime() > 30 * 86400000) {
      throw new BadRequestException('delegation window cannot exceed 30 days');
    }
    // Only the delegator themselves — or a workspace admin — can create the delegation.
    const actorIsDelegator = actorUserId === body.delegatorUserId;
    if (!actorIsDelegator) {
      const adm = await this.prisma.membership.findFirst({
        where: { tenantId, userId: actorUserId, roleKey: { in: ['workspace_owner', 'workspace_admin'] } },
      });
      if (!adm) throw new ForbiddenException('only the delegator or a workspace admin can create a delegation');
    }
    return this.prisma.approvalDelegation.create({
      data: {
        tenantId,
        delegatorUserId: body.delegatorUserId,
        delegateUserId: body.delegateUserId,
        role: body.role,
        buildingId: body.buildingId ?? null,
        startsAt, endsAt,
        reason: body.reason || null,
        createdByUserId: actorUserId,
      },
    });
  }

  async revoke(tenantId: string, actorUserId: string, id: string) {
    const d = await this.prisma.approvalDelegation.findFirst({ where: { id, tenantId } });
    if (!d) throw new NotFoundException('delegation not found');
    if (d.revokedAt) return d;
    return this.prisma.approvalDelegation.update({
      where: { id },
      data: { revokedAt: new Date(), revokedByUserId: actorUserId },
    });
  }

  async list(tenantId: string, params: { delegateUserId?: string; delegatorUserId?: string; activeOnly?: boolean }) {
    const where: any = { tenantId };
    if (params.delegateUserId) where.delegateUserId = params.delegateUserId;
    if (params.delegatorUserId) where.delegatorUserId = params.delegatorUserId;
    if (params.activeOnly) {
      const now = new Date();
      where.revokedAt = null;
      where.startsAt = { lte: now };
      where.endsAt = { gte: now };
    }
    return this.prisma.approvalDelegation.findMany({
      where,
      orderBy: [{ revokedAt: 'asc' }, { endsAt: 'desc' }],
      take: 200,
    });
  }

  /**
   * Returns the active delegation (if any) that lets `candidateUserId` act
   * on behalf of somebody else for `role` in `buildingId`.
   */
  async activeDelegationFor(tenantId: string, candidateUserId: string, role: string, buildingId?: string | null) {
    const now = new Date();
    const rows = await this.prisma.approvalDelegation.findMany({
      where: {
        tenantId,
        delegateUserId: candidateUserId,
        role,
        revokedAt: null,
        startsAt: { lte: now },
        endsAt: { gte: now },
        OR: [{ buildingId: null }, { buildingId: buildingId || undefined }],
      },
      orderBy: { endsAt: 'asc' },
    });
    return rows[0] || null;
  }
}
