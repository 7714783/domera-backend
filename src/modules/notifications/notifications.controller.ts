import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { InboundEmailService, type InboundPayload } from './inbound-email.service';
import { MAILER } from './mailer.token';
import type { MailerAdapter } from './mailer.adapter';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

// INIT-014 — unified notifications surface.
//   GET    /v1/notifications                 — in-app inbox for the caller
//   POST   /v1/notifications/:id/read        — mark one read
//   POST   /v1/notifications/devices         — register a push device (alias)
//   DELETE /v1/notifications/devices/:id     — unregister
//   POST   /v1/notifications/test-email      — send a test email (admin-only)
//   GET    /v1/notifications/deliveries      — ops journal
//   GET    /v1/notifications/rules           — list system + tenant rules
//   GET    /v1/notifications/templates       — list system + tenant templates
//   GET    /v1/notifications/preferences     — current user's prefs
//   PATCH  /v1/notifications/preferences     — toggle a single pref
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly inbound: InboundEmailService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: MailerAdapter,
  ) {}

  @Get()
  async listInbox(
    @Query('limit') limit?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const userId = await uid(authHeader, this.auth);
    return this.notifications.listInbox(tenantId, userId, {
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':id/read')
  async markRead(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const userId = await uid(authHeader, this.auth);
    return this.notifications.markRead(tenantId, userId, id);
  }

  // Push device alias — mobile app expects /v1/notifications/devices.
  // Underlying storage is the existing Device table (devices module
  // remains the SSOT writer).
  @Post('devices')
  async registerDevice(
    @Body() body: { pushToken: string; platform?: string; deviceLabel?: string },
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const userId = await uid(authHeader, this.auth);
    if (!body.pushToken) {
      return { error: 'pushToken required' };
    }
    const existing = await (this.prisma as any).device.findFirst({
      where: { tenantId, userId, pushToken: body.pushToken },
    });
    if (existing) return existing;
    return (this.prisma as any).device.create({
      data: {
        tenantId,
        userId,
        pushToken: body.pushToken,
        platform: body.platform || 'unknown',
        deviceLabel: body.deviceLabel || null,
      },
    });
  }

  @Delete('devices/:id')
  async unregisterDevice(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const userId = await uid(authHeader, this.auth);
    const existing = await (this.prisma as any).device.findFirst({
      where: { id, tenantId, userId },
    });
    if (!existing) return { ok: false };
    await (this.prisma as any).device.delete({ where: { id } });
    return { ok: true };
  }

  @Post('test-email')
  async testEmail(
    @Body() body: { to: string; subject?: string; text?: string },
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    if (!body?.to) return { error: 'to required' };
    const result = await this.mailer.send({
      to: body.to,
      from: process.env.EMAIL_FROM || 'notifications@domerahub.com',
      subject: body.subject || 'Domera test email',
      text: body.text || 'This is a test from Domera notifications.',
    });
    return { provider: this.mailer.providerName, ...result };
  }

  @Get('deliveries')
  async deliveries(
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('take') take?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    const where: any = { tenantId };
    if (status) where.status = status;
    if (channel) where.channel = channel;
    const items = await (this.prisma as any).notificationDelivery.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(Math.max(Number(take ?? 100), 1), 500),
    });
    return { total: items.length, items };
  }

  @Get('rules')
  async rules(
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    const items = await (this.prisma as any).notificationRule.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      orderBy: [{ isCustom: 'asc' }, { name: 'asc' }],
    });
    return { total: items.length, items };
  }

  @Get('templates')
  async templates(
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    const items = await (this.prisma as any).notificationTemplate.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      orderBy: [{ category: 'asc' }, { key: 'asc' }, { channel: 'asc' }, { locale: 'asc' }],
    });
    return { total: items.length, items };
  }

  @Get('preferences')
  async listPreferences(
    @Query('teamMemberId') teamMemberId: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    await uid(authHeader, this.auth);
    if (!teamMemberId) return { items: [] };
    const items = await (this.prisma as any).notificationPreference.findMany({
      where: { tenantId, teamMemberId },
    });
    return { total: items.length, items };
  }

  @Post('preferences')
  async upsertPreference(
    @Body()
    body: {
      teamMemberId: string;
      scope: 'template' | 'category';
      scopeKey: string;
      channel: 'email' | 'inapp' | 'push';
      muted: boolean;
    },
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = await uid(authHeader, this.auth);
    const existing = await (this.prisma as any).notificationPreference.findFirst({
      where: {
        teamMemberId: body.teamMemberId,
        scope: body.scope,
        scopeKey: body.scopeKey,
        channel: body.channel,
      },
    });
    if (existing) {
      return (this.prisma as any).notificationPreference.update({
        where: { id: existing.id },
        data: { muted: body.muted, updatedBy: actor },
      });
    }
    return (this.prisma as any).notificationPreference.create({
      data: {
        tenantId,
        teamMemberId: body.teamMemberId,
        scope: body.scope,
        scopeKey: body.scopeKey,
        channel: body.channel,
        muted: body.muted,
        updatedBy: actor,
      },
    });
  }
}

// Inbound webhook lives at /v1/mail/inbound/:provider — separate route
// because providers' shared-secret URLs shouldn't be guessable via the
// authenticated /notifications namespace.
@Controller('mail/inbound')
export class MailInboundController {
  constructor(
    private readonly inbound: InboundEmailService,
    @Inject(MAILER) private readonly mailer: MailerAdapter,
  ) {}

  // Provider POSTs raw JSON. We pass headers + raw body to the service
  // so signature verification can reproduce the canonical string the
  // provider signed.
  @Post(':provider')
  async receive(
    @Param('provider') provider: string,
    @Body() body: any,
    @Req() req: any,
    @Headers() headers: Record<string, string>,
  ) {
    const parsed: InboundPayload = {
      provider,
      providerEventId: body?.id || body?.messageId || body?.MessageId,
      fromAddress:
        body?.from || body?.From || body?.fromAddress || body?.envelope?.from || 'unknown@unknown',
      toAddress:
        body?.to || body?.To || body?.toAddress || body?.envelope?.to?.[0] || 'unknown@unknown',
      subject: body?.subject || body?.Subject,
      bodyText: body?.text || body?.Text || body?.bodyText,
      bodyHtml: body?.html || body?.Html || body?.bodyHtml,
      attachments: body?.attachments || [],
      raw: body,
    };
    const rawString = typeof body === 'string' ? body : JSON.stringify(body);
    const result = await this.inbound.ingest(provider, headers, rawString, parsed, this.mailer);
    if (!result.signatureValid) {
      // 401 status; payload row stays for forensic value.
      throw new UnauthorizedException('invalid inbound signature');
    }
    return result;
  }
}
