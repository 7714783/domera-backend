import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function toScimUser(u: any, tenantId: string) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: u.id,
    externalId: u.seedKey || null,
    userName: u.username || u.emailNormalized,
    name: { formatted: u.displayName || u.emailNormalized },
    emails: [{ value: u.email, primary: true }],
    active: u.status === 'active',
    meta: {
      resourceType: 'User',
      created: u.createdAt,
      lastModified: u.updatedAt,
      location: `/scim/v2/Users/${u.id}`,
    },
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { tenantId },
  };
}

@Injectable()
export class ScimService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Token management (admin) ────────────────────────────
  async listTokens(tenantId: string) {
    return this.prisma.scimToken.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, label: true, isActive: true,
        createdAt: true, lastUsedAt: true, revokedAt: true,
      },
    });
  }

  async createToken(tenantId: string, actorUserId: string, label: string) {
    if (!label) throw new BadRequestException('label required');
    const raw = `scim_${randomBytes(24).toString('hex')}`;
    await this.prisma.scimToken.create({
      data: {
        tenantId, tokenHash: sha256(raw),
        label, createdByUserId: actorUserId,
      },
    });
    return { token: raw, label, note: 'Store this value — it will not be shown again.' };
  }

  async revokeToken(tenantId: string, id: string) {
    const t = await this.prisma.scimToken.findFirst({ where: { id, tenantId } });
    if (!t) throw new NotFoundException('token not found');
    await this.prisma.scimToken.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
    });
    return { ok: true };
  }

  // ── Auth: bearer token via Authorization header ────────
  async authenticate(tenantId: string, authHeader: string | undefined): Promise<void> {
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('SCIM requires Bearer token');
    }
    const raw = authHeader.slice(7).trim();
    const t = await this.prisma.scimToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!t || !t.isActive || t.tenantId !== tenantId) {
      throw new UnauthorizedException('invalid or inactive SCIM token');
    }
    await this.prisma.scimToken.update({
      where: { id: t.id }, data: { lastUsedAt: new Date() },
    });
  }

  // ── /scim/v2/Users ─────────────────────────────────────
  async listUsers(tenantId: string, filter?: string, startIndex = 1, count = 100) {
    const take = Math.min(Math.max(count, 1), 500);
    const skip = Math.max(startIndex - 1, 0);

    // SCIM filter: we support `userName eq "..."` and `emails.value eq "..."` (minimum RFC 7644)
    let where: any = {
      memberships: { some: { tenantId } },
    };
    if (filter) {
      const m = filter.match(/(\w+(?:\.\w+)?)\s+eq\s+"([^"]+)"/i);
      if (m) {
        const [, field, value] = m;
        if (field === 'userName') where.username = value;
        else if (field === 'emails.value') where.emailNormalized = value.toLowerCase();
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, take, skip, orderBy: { createdAt: 'asc' } }),
      this.prisma.user.count({ where }),
    ]);

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex,
      itemsPerPage: items.length,
      Resources: items.map((u) => toScimUser(u, tenantId)),
    };
  }

  async getUser(tenantId: string, id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, memberships: { some: { tenantId } } },
    });
    if (!u) throw new NotFoundException({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: '404' });
    return toScimUser(u, tenantId);
  }

  async createUser(tenantId: string, body: any) {
    const userName = body?.userName || body?.emails?.[0]?.value;
    if (!userName) throw new BadRequestException('userName required');
    const email = (body?.emails?.[0]?.value || userName).toLowerCase();
    const displayName = body?.name?.formatted || body?.displayName || userName;
    const active = body?.active !== false;

    const existing = await this.prisma.user.findUnique({ where: { emailNormalized: email } });
    if (existing) {
      const mem = await this.prisma.membership.findFirst({ where: { tenantId, userId: existing.id } });
      if (!mem) {
        await this.prisma.membership.create({ data: { tenantId, userId: existing.id, roleKey: 'workspace_member' } });
      }
      return toScimUser(existing, tenantId);
    }

    const user = await this.prisma.user.create({
      data: {
        username: userName, email, emailNormalized: email,
        displayName, status: active ? 'active' : 'suspended',
        createdBy: 'scim',
      },
    });
    await this.prisma.membership.create({
      data: { tenantId, userId: user.id, roleKey: 'workspace_member' },
    });
    return toScimUser(user, tenantId);
  }

  async patchUser(tenantId: string, id: string, body: any) {
    const u = await this.prisma.user.findFirst({
      where: { id, memberships: { some: { tenantId } } },
    });
    if (!u) throw new NotFoundException('user not found');
    const ops: any[] = body?.Operations || [];
    const update: any = {};
    for (const op of ops) {
      const path = op.path as string | undefined;
      const value = op.value;
      if (!path && value && typeof value === 'object') {
        if (value.active !== undefined) update.status = value.active ? 'active' : 'suspended';
        if (value.displayName !== undefined) update.displayName = value.displayName;
      } else if (path === 'active') {
        update.status = value ? 'active' : 'suspended';
      } else if (path === 'displayName' || path === 'name.formatted') {
        update.displayName = value;
      } else if (path === 'userName') {
        update.username = value;
      }
    }
    if (Object.keys(update).length === 0) return toScimUser(u, tenantId);
    const updated = await this.prisma.user.update({ where: { id }, data: update });
    return toScimUser(updated, tenantId);
  }

  async deleteUser(tenantId: string, id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, memberships: { some: { tenantId } } },
    });
    if (!u) throw new NotFoundException('user not found');
    // RFC 7644: DELETE is optional; we soft-deprovision by removing tenant membership
    // and revoking sessions. User row survives for audit continuity.
    await this.prisma.membership.deleteMany({ where: { tenantId, userId: id } });
    await this.prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy: 'scim' },
    });
    return { ok: true };
  }
}
