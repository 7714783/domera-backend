import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma/prisma.service';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-domera-secret-change-me';
const JWT_TTL_SECONDS = 60 * 60 * 24 * 7;

type Payload = { sub: string; username: string | null; superadmin: boolean; jti: string };

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private sign(user: { id: string; username: string | null; isSuperAdmin: boolean }, jti: string) {
    return jwt.sign(
      { sub: user.id, username: user.username, superadmin: user.isSuperAdmin, jti },
      JWT_SECRET,
      { expiresIn: JWT_TTL_SECONDS },
    );
  }

  verify(token: string): Payload | null {
    try {
      return jwt.verify(token, JWT_SECRET) as Payload;
    } catch {
      return null;
    }
  }

  /**
   * Validate a bearer token against the sessions table.
   * Returns payload only if:
   *  - JWT signature valid
   *  - session row exists by tokenHash
   *  - session is not revoked and not expired
   */
  async verifySession(token: string): Promise<Payload | null> {
    const payload = this.verify(token);
    if (!payload) return null;
    const row = await this.prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    if (row.userId !== payload.sub) return null;
    // fire-and-forget last-seen bump (ignore errors)
    this.prisma.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    return payload;
  }

  private async createSession(
    userId: string,
    token: string,
    meta?: { userAgent?: string; ipAddress?: string },
  ) {
    return this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + JWT_TTL_SECONDS * 1000),
        userAgent: meta?.userAgent || null,
        ipAddress: meta?.ipAddress || null,
      },
    });
  }

  /**
   * Issue a JWT + session row for a user who authenticated out-of-band
   * (e.g. SSO, SCIM password reset). Used by the SsoService after a
   * successful OIDC callback.
   */
  async issueSession(userId: string, meta?: { userAgent?: string; ipAddress?: string; source?: string; providerKey?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, isSuperAdmin: true },
    });
    if (!user) throw new UnauthorizedException('user not found');
    const jti = crypto.randomUUID();
    const token = this.sign(user, jti);
    await this.createSession(userId, token, { userAgent: meta?.userAgent, ipAddress: meta?.ipAddress });
    return { token, jti };
  }

  async register(
    body: { username: string; password: string; email?: string; displayName?: string },
    meta?: { userAgent?: string; ipAddress?: string },
  ) {
    if (!body.username || body.username.length < 3) throw new BadRequestException('username too short');
    if (!body.password || body.password.length < 8) throw new BadRequestException('password too short');

    const existing = await this.prisma.user.findUnique({ where: { username: body.username } });
    if (existing) throw new ConflictException('username already taken');

    const email = (body.email || `${body.username.toLowerCase()}@users.local`).toLowerCase();
    const emailConflict = await this.prisma.user.findUnique({ where: { emailNormalized: email } });
    if (emailConflict) throw new ConflictException('email already taken');

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await this.prisma.user.create({
      data: {
        username: body.username,
        email,
        emailNormalized: email,
        passwordHash,
        displayName: body.displayName || body.username,
        status: 'active',
        createdBy: 'register',
      },
    });

    const jti = crypto.randomUUID();
    const token = this.sign(user, jti);
    await this.createSession(user.id, token, meta);
    return {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName, email: user.email, isSuperAdmin: user.isSuperAdmin },
    };
  }

  async login(
    body: { username?: string; email?: string; password: string },
    meta?: { userAgent?: string; ipAddress?: string },
  ) {
    const identifier = body.username || body.email;
    if (!identifier || !body.password) throw new BadRequestException('username/email and password required');

    // Accept either username or email — some frontends send "admin@domerahub.com"
    // in the username field, others split them. Look up by whichever is non-empty.
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { emailNormalized: identifier.toLowerCase() },
        ],
      },
    });
    if (!user || !user.passwordHash) throw new UnauthorizedException('invalid credentials');

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const jti = crypto.randomUUID();
    const token = this.sign(user, jti);
    await this.createSession(user.id, token, meta);
    return {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName, email: user.email, isSuperAdmin: user.isSuperAdmin },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, displayName: true, email: true, isSuperAdmin: true, status: true,
        // Tenant-level memberships are needed by the frontend login router to
        // decide whether a just-authenticated user has any workspace at all.
        // Without this a superadmin with a platform-only membership would be
        // wrongly routed to /setup after login.
        memberships: {
          where: { status: 'active' },
          select: {
            id: true, roleKey: true, status: true,
            tenant: { select: { id: true, slug: true, name: true } },
          },
        },
        organizationMemberships: { include: { organization: { select: { id: true, name: true, slug: true, tenantId: true, type: true } } } },
        buildingRoles: { include: { building: { select: { id: true, name: true, slug: true, tenantId: true } }, role: { select: { key: true, name: true } } } },
      },
    });
    if (!user) throw new UnauthorizedException('user not found');
    const normalizedMemberships = user.memberships.map((m) => ({
      id: m.id,
      tenantId: m.tenant.id,
      tenantSlug: m.tenant.slug,
      tenantName: m.tenant.name,
      roleKey: m.roleKey,
      status: m.status,
    }));
    return { ...user, memberships: normalizedMemberships };
  }

  async listSessions(userId: string) {
    const items = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, userAgent: true, ipAddress: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    return { total: items.length, items };
  }

  async logout(token: string, actorUserId: string) {
    const hash = sha256(token);
    const row = await this.prisma.session.findUnique({ where: { tokenHash: hash } });
    if (!row || row.userId !== actorUserId) return { revoked: false };
    if (row.revokedAt) return { revoked: false };
    await this.prisma.session.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), revokedBy: actorUserId },
    });
    return { revoked: true };
  }

  async logoutAll(actorUserId: string) {
    const { count } = await this.prisma.session.updateMany({
      where: { userId: actorUserId, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy: actorUserId },
    });
    return { revoked: count };
  }

  /** Prune all expired / old-revoked sessions. Safe to call from a scheduled job. */
  async prune(olderThanDays = 30) {
    const cutoff = new Date(Date.now() - olderThanDays * 86400 * 1000);
    const { count } = await this.prisma.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { lt: cutoff } },
        ],
      },
    });
    return { pruned: count };
  }

  // ── Privileged operations invoked by the Privacy module (DSAR). The auth
  // module owns the users + sessions tables; callers must route through these
  // methods rather than writing those tables directly.
  async anonymizeUser(userId: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    const anonymized = `deleted-${user.id.slice(0, 8)}@redacted.local`;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        email: anonymized, emailNormalized: anonymized,
        displayName: 'Deleted User', passwordHash: null, status: 'deleted',
      },
    });
    await this.prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy: reason },
    });
    return { userId: user.id, anonymizedEmail: anonymized };
  }

  async suspendUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    await this.prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });
    return { userId: user.id };
  }

  async findUserBySubject(subjectUserId: string | null | undefined, subjectEmail: string | null | undefined) {
    if (subjectUserId) return this.prisma.user.findUnique({ where: { id: subjectUserId } });
    if (subjectEmail) return this.prisma.user.findUnique({ where: { emailNormalized: subjectEmail } });
    return null;
  }
}
