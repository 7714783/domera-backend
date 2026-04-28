import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

function hmacHex(algo: string, key: string, body: string): string {
  return createHmac(algo, key).update(body).digest('hex');
}

function sigMatches(provided: string, computed: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(computed, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Outbound subscriptions ────────────────────────────
  async listSubscriptions(tenantId: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        eventTypes: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        createdByUserId: true,
      },
    });
  }

  async createSubscription(
    tenantId: string,
    actorUserId: string,
    body: { url: string; eventTypes?: string[] },
  ) {
    if (!body.url || !/^https?:\/\//i.test(body.url))
      throw new BadRequestException('valid url required');
    const secret = randomBytes(32).toString('hex');
    const sub = await this.prisma.webhookSubscription.create({
      data: {
        tenantId,
        url: body.url,
        eventTypes: body.eventTypes || [],
        sharedSecret: secret,
        createdByUserId: actorUserId,
      },
    });
    return { ...sub, sharedSecret: secret };
  }

  async deleteSubscription(tenantId: string, id: string) {
    const r = await this.prisma.webhookSubscription.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('subscription not found');
    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { ok: true };
  }

  // ── Inbound sources ────────────────────────────────────
  async listInbound(tenantId: string) {
    return this.prisma.inboundWebhookSource.findMany({
      where: { tenantId },
      orderBy: { channel: 'asc' },
      select: {
        id: true,
        channel: true,
        signatureHeader: true,
        signatureAlgo: true,
        isActive: true,
        createdAt: true,
        createdByUserId: true,
      },
    });
  }

  async registerInbound(
    tenantId: string,
    actorUserId: string,
    body: {
      channel: string;
      signatureHeader?: string;
      signatureAlgo?: string;
    },
  ) {
    if (!body.channel) throw new BadRequestException('channel required');
    const secret = randomBytes(32).toString('hex');
    const src = await this.prisma.inboundWebhookSource.create({
      data: {
        tenantId,
        channel: body.channel,
        sharedSecret: secret,
        signatureHeader: body.signatureHeader || 'x-signature',
        signatureAlgo: body.signatureAlgo || 'sha256',
        createdByUserId: actorUserId,
      },
    });
    return { ...src, sharedSecret: secret };
  }

  /**
   * Verify + log an inbound webhook delivery. Caller passes the raw body,
   * the headers, and the channel key (in the URL). The signature header is
   * compared against HMAC(secret, rawBody).
   */
  async ingestInbound(
    tenantId: string,
    channel: string,
    headers: Record<string, string>,
    rawBody: string,
  ) {
    const src = await this.prisma.inboundWebhookSource.findFirst({
      where: { tenantId, channel, isActive: true },
    });
    if (!src) throw new NotFoundException(`no active inbound source for channel ${channel}`);

    const provided = headers[src.signatureHeader.toLowerCase()] || '';
    const clean = provided.replace(/^sha256=/i, '');
    const computed = hmacHex(src.signatureAlgo, src.sharedSecret, rawBody);
    const ok = clean.length > 0 && sigMatches(clean, computed);

    await this.prisma.inboundWebhookEvent.create({
      data: {
        tenantId,
        channel,
        signatureOk: ok,
        rawHeaders: headers as any,
        rawBody: rawBody.slice(0, 200_000),
        action: ok ? 'logged' : 'rejected',
        notes: ok ? null : 'signature verification failed',
      },
    });
    if (!ok) throw new ForbiddenException('signature verification failed');
    return { ok: true, channel };
  }

  async listInboundEvents(tenantId: string, params: { channel?: string; take?: number }) {
    const take = Math.min(Math.max(params.take || 50, 1), 500);
    const where: any = { tenantId };
    if (params.channel) where.channel = params.channel;
    return this.prisma.inboundWebhookEvent.findMany({
      where,
      take,
      orderBy: { receivedAt: 'desc' },
      select: {
        id: true,
        channel: true,
        receivedAt: true,
        signatureOk: true,
        action: true,
        notes: true,
      },
    });
  }
}
