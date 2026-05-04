// GROWTH-001 NS-19 — invite flow.
//
// Manager creates an invite (POST /v1/invites). The service mints a
// random 32-byte token, stores its sha256 hash in the row, and returns
// the plaintext ONCE in the response (so the inviter can paste it into
// a chat / email / pigeon). The plaintext is also handed to the
// notifications module so an email can be dispatched via the
// notifications.invite.created event — but that path is best-effort:
// even if mail delivery fails the inviter still has the plaintext to
// share manually.
//
// Tokens are single-use, expire 72h after creation, and are scoped to
// (tenantId, email). Accept consumes the row in a transaction:
//   1. Look up by tokenHash (UNIQUE).
//   2. Reject if status != 'pending' or expiresAt < now.
//   3. Create or upsert the User by email; create a Membership row;
//      mark the invite as accepted.
//
// Hard rules (pinned by tests):
//   - tokens stored hashed (sha256), never plaintext at rest.
//   - manager-gated create.
//   - single-use: status flips pending→accepted on first accept.
//   - 72h expiry — set at create time, not at accept time.

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../events/outbox.service';
import { requireManager } from '../../common/building.helpers';

const INVITE_TTL_HOURS = 72;
const VALID_STATUSES = ['pending', 'accepted', 'expired', 'revoked'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Manager-gated create ─────────────────────────────
  async create(
    tenantId: string,
    actorUserId: string,
    body: { email: string; roleKey: string; buildingIds?: string[] },
  ) {
    await requireManager(this.prisma, tenantId, actorUserId);
    if (!body?.email || !EMAIL_RE.test(body.email))
      throw new BadRequestException('valid email required');
    if (!body?.roleKey) throw new BadRequestException('roleKey required');

    // Dedup: one pending invite per (tenant, email). The unique
    // partial index in 024_invites.sql enforces this at the DB layer
    // too, but a friendly app-layer error beats a Prisma constraint
    // error.
    const existing = await this.prisma.invite.findFirst({
      where: { tenantId, email: body.email.toLowerCase(), status: 'pending' },
      select: { id: true },
    });
    if (existing)
      throw new BadRequestException(
        `a pending invite already exists for ${body.email} — revoke it first`,
      );

    // Mint a random token; hash before persistence.
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600_000);

    const invite = await this.prisma.invite.create({
      data: {
        tenantId,
        email: body.email.toLowerCase(),
        roleKey: body.roleKey,
        buildingIds: body.buildingIds || [],
        tokenHash,
        invitedBy: actorUserId,
        status: 'pending',
        expiresAt,
      },
    });

    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'manager',
      action: 'invite.created',
      entity: invite.id,
      entityType: 'invite',
      building: '',
      ip: '',
      sensitive: false,
      eventType: 'invite.created',
      metadata: {
        email: invite.email,
        roleKey: invite.roleKey,
        expiresAt: expiresAt.toISOString(),
      },
    });

    // Frontend accept-invite URL — the notifications mailer templates
    // this directly into the email body. Pulled from env so the same
    // backend can serve dev (localhost:3000) and prod (domerahub.com)
    // without code changes.
    const acceptBaseUrl = (process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    const acceptUrl = `${acceptBaseUrl}/en/accept-invite/${encodeURIComponent(token)}`;

    await this.outbox.publish(this.prisma, {
      type: 'invite.created',
      source: 'invites',
      subject: invite.id,
      payload: {
        tenantId,
        inviteId: invite.id,
        email: invite.email,
        roleKey: invite.roleKey,
        invitedBy: actorUserId,
        // Plaintext token MUST go through the outbox into the
        // notifications mailer template — not into audit. The audit
        // entry above intentionally omits it.
        token,
        acceptUrl,
        expiresAt: expiresAt.toISOString(),
        // Manual recipient strategy — the invitee may not have a
        // TeamMember row yet, so we route by raw email. The
        // recipient-resolver supports recipientEmails[] for the
        // manual strategy.
        recipientEmails: [invite.email],
      },
    });

    // Return plaintext once so the inviter can copy/share manually
    // even if email delivery is delayed/blocked.
    return {
      id: invite.id,
      email: invite.email,
      roleKey: invite.roleKey,
      buildingIds: invite.buildingIds,
      status: invite.status,
      expiresAt: invite.expiresAt,
      token,
    };
  }

  // ── List + revoke (manager-gated) ────────────────────
  async list(tenantId: string, actorUserId: string, opts: { status?: string } = {}) {
    await requireManager(this.prisma, tenantId, actorUserId);
    const status = opts.status && VALID_STATUSES.includes(opts.status as any) ? opts.status : null;
    return this.prisma.invite.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        email: true,
        roleKey: true,
        buildingIds: true,
        invitedBy: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
    });
  }

  async revoke(tenantId: string, actorUserId: string, inviteId: string) {
    await requireManager(this.prisma, tenantId, actorUserId);
    const invite = await this.prisma.invite.findFirst({
      where: { tenantId, id: inviteId },
      select: { id: true, status: true },
    });
    if (!invite) throw new NotFoundException('invite not found');
    if (invite.status !== 'pending')
      throw new BadRequestException(`cannot revoke ${invite.status} invite`);
    const updated = await this.prisma.invite.update({
      where: { id: inviteId },
      data: { status: 'revoked' },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'manager',
      action: 'invite.revoked',
      entity: inviteId,
      entityType: 'invite',
      building: '',
      ip: '',
      sensitive: false,
      eventType: 'invite.revoked',
    });
    return { id: updated.id, status: updated.status };
  }

  // ── Accept (public — token IS the auth) ──────────────
  // Public route: NO bearer token expected. The plaintext invite token
  // is the authn material; we hash it and look up by hash. The accept
  // path is rate-limited at the controller level so brute-forcing
  // tokens is impractical (32 bytes random + 72h TTL + per-IP rate
  // limit = effectively impossible).
  async accept(token: string, body: { fullName?: string; password?: string }) {
    if (!token) throw new BadRequestException('token required');
    const tokenHash = hashToken(token);

    // findFirst (not findUnique) because we want to scope by status
    // before throwing — gives a friendlier error.
    const invite = await this.prisma.invite.findFirst({ where: { tokenHash } });
    if (!invite) throw new NotFoundException('invite not found');

    if (invite.status === 'accepted') throw new BadRequestException('invite already accepted');
    if (invite.status === 'revoked') throw new ForbiddenException('invite revoked');
    if (invite.expiresAt.getTime() < Date.now()) {
      // Auto-flip to expired so subsequent accepts get the cleaner
      // error rather than re-checking ttl every time.
      await this.prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'expired' },
      });
      throw new ForbiddenException('invite expired');
    }

    // Side-channel: the actual user/membership creation is delegated to
    // the iam module via the events bus. We mark the invite accepted
    // synchronously (so a retry can't double-spend the token) and emit
    // invite.accepted with the body so iam.onModuleInit subscriber can
    // create the User + Membership. v1 returns just the invite id +
    // tenantId so the frontend can route to /accept-invite/:id/done.
    const accepted = await this.prisma.invite.update({
      where: { id: invite.id },
      data: { status: 'accepted', acceptedAt: new Date() },
    });

    await this.audit.write({
      tenantId: invite.tenantId,
      actor: 'invite-accept',
      role: 'public',
      action: 'invite.accepted',
      entity: invite.id,
      entityType: 'invite',
      building: '',
      ip: '',
      sensitive: false,
      eventType: 'invite.accepted',
    });

    await this.outbox.publish(this.prisma, {
      type: 'invite.accepted',
      source: 'invites',
      subject: invite.id,
      payload: {
        tenantId: invite.tenantId,
        inviteId: invite.id,
        email: invite.email,
        roleKey: invite.roleKey,
        buildingIds: invite.buildingIds,
        fullName: body?.fullName || null,
        password: body?.password || null,
      },
    });

    return {
      id: accepted.id,
      tenantId: accepted.tenantId,
      email: accepted.email,
      roleKey: accepted.roleKey,
      status: accepted.status,
    };
  }
}
