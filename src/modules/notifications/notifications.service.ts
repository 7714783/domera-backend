// INIT-014 — Notifications service.
//
// Three responsibilities:
//   1. dispatchEvent() — called by the OutboxRegistry handler. Looks up
//      every active rule matching the event type, resolves recipients,
//      renders the template per channel, and creates pending
//      NotificationDelivery rows. Idempotent via dedupKey =
//      `${eventId}:${recipient}:${channel}`.
//   2. processPending() — called by the worker loop. Picks pending rows,
//      attempts delivery via the appropriate channel (mailer for email,
//      Notification table for in-app, Device table for push), updates
//      status + attempts. Retries with exponential backoff up to
//      maxAttempts; then status='failed' (dead-letter).
//   3. listInbox(userId) — read-only feed for the in-app inbox.
//
// audit.write is called for every successful email delivery (sensitive
// for finance/security templates) and for every dead-lettered failure.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MigratorPrismaService } from '../../prisma/prisma.migrator';
import { AuditService } from '../audit/audit.service';
import { RecipientResolverService } from './recipient-resolver.service';
import type { OutboxEventEnvelope } from '../events/outbox.registry';
import { renderTemplate } from './template.engine';
import type { MailerAdapter } from './mailer.adapter';

const SENSITIVE_TEMPLATES = new Set([
  'approval.requested',
  'approval.decided',
  'invoice.awaiting_confirmation',
  'role.assigned',
]);

const RETRY_BACKOFF_MS = [
  60_000, // 1 min
  5 * 60_000, // 5 min
  30 * 60_000, // 30 min
  2 * 3600_000, // 2 h
  6 * 3600_000, // 6 h
];

@Injectable()
export class NotificationsService {
  private readonly log = new Logger('NotificationsService');

  constructor(
    private readonly prisma: PrismaService,
    // Bypass-RLS client for the worker loop — it must scan deliveries
    // across tenants; the per-row tenantId scoping is enforced manually.
    private readonly migrator: MigratorPrismaService,
    private readonly audit: AuditService,
    private readonly resolver: RecipientResolverService,
  ) {}

  // Called by the outbox subscriber when a domain event fires. Idempotent.
  async dispatchEvent(event: OutboxEventEnvelope, mailer: MailerAdapter): Promise<void> {
    // Match every active rule for this event type. System rules
    // (tenantId IS NULL) and tenant-custom rules can both match; if both
    // exist we run both — admins use isActive=false to silence one.
    const rules = await (this.migrator as any).notificationRule.findMany({
      where: {
        eventType: event.type,
        isActive: true,
        OR: [{ tenantId: null }, { tenantId: event.tenantId }],
      },
    });
    if (!rules.length) return;

    for (const rule of rules) {
      for (const channel of rule.channels as string[]) {
        const recipients = await this.resolver.resolve({
          tenantId: event.tenantId,
          rule,
          payload: event.payload,
          channel,
        });
        for (const r of recipients) {
          await this.createDelivery(event, rule, channel, r);
        }
      }
    }
  }

  private async createDelivery(
    event: OutboxEventEnvelope,
    rule: any,
    channel: string,
    recipient: { teamMemberId: string; email: string | null; displayName: string; userId: string | null },
  ): Promise<void> {
    const dedupKey = `${event.id}:${recipient.teamMemberId || recipient.email || 'anon'}:${channel}`;

    // Idempotency: try to insert; ignore unique-violation. Saves the
    // round-trip of a SELECT + race-condition window.
    try {
      let subject: string | null = null;
      let body: string | null = null;
      if (rule.templateKey && (channel === 'email' || channel === 'inapp')) {
        const tpl = await this.findTemplate(event.tenantId, rule.templateKey, channel, 'en');
        if (tpl) {
          const ctx = {
            recipientName: recipient.displayName,
            ...(event.payload as Record<string, unknown>),
          };
          subject = tpl.subject ? renderTemplate(tpl.subject, ctx) : null;
          body =
            channel === 'email'
              ? renderTemplate(tpl.bodyHtml || tpl.bodyText || '', ctx)
              : renderTemplate(tpl.bodyText || tpl.bodyHtml || '', ctx);
        }
      }

      await (this.migrator as any).notificationDelivery.create({
        data: {
          tenantId: event.tenantId,
          ruleId: rule.id,
          templateKey: rule.templateKey,
          eventId: event.id,
          eventType: event.type,
          channel,
          recipientType: 'team_member',
          recipientId: recipient.teamMemberId || null,
          recipientAddress: channel === 'email' ? recipient.email : recipient.userId,
          subjectSnapshot: subject,
          bodySnapshot: body,
          payloadSnapshot: event.payload as any,
          priority: rule.priority,
          status: 'pending',
          dedupKey,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // Already created — duplicate event delivery, fine.
        return;
      }
      throw e;
    }
  }

  // Worker loop entry point. Picks `batchSize` pending rows due now,
  // attempts delivery, updates status. Caller is expected to re-invoke
  // on a timer.
  async processPending(mailer: MailerAdapter, batchSize = 25): Promise<{ processed: number }> {
    const now = new Date();
    const due = await (this.migrator as any).notificationDelivery.findMany({
      where: { status: 'pending', scheduledAt: { lte: now } },
      orderBy: [{ priority: 'desc' }, { scheduledAt: 'asc' }],
      take: batchSize,
    });
    if (!due.length) return { processed: 0 };

    let processed = 0;
    for (const row of due) {
      const claimed = await (this.migrator as any).notificationDelivery.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'sending' },
      });
      if (!claimed.count) continue; // raced with another worker
      processed++;

      try {
        if (row.channel === 'email') {
          await this.deliverEmail(row, mailer);
        } else if (row.channel === 'inapp') {
          await this.deliverInApp(row);
        } else if (row.channel === 'push') {
          await this.deliverPush(row);
        } else {
          await this.markFailed(row, `unknown channel: ${row.channel}`, false);
        }
      } catch (e) {
        await this.markFailed(row, (e as Error).message, true);
      }
    }
    return { processed };
  }

  private async deliverEmail(row: any, mailer: MailerAdapter): Promise<void> {
    if (!row.recipientAddress) {
      await this.markFailed(row, 'no email address', false);
      return;
    }
    const fromAddr = process.env.EMAIL_FROM || 'notifications@domerahub.com';
    const subject = row.subjectSnapshot || '(no subject)';
    const bodyHtml = row.bodySnapshot || '';
    const bodyText = stripHtml(bodyHtml);

    const result = await mailer.send({
      to: row.recipientAddress,
      from: fromAddr,
      subject,
      html: bodyHtml,
      text: bodyText,
      headers: {
        'X-Domera-Delivery': row.id,
        'X-Domera-Tenant': row.tenantId,
        ...(row.eventType ? { 'X-Domera-Event': row.eventType } : {}),
      },
    });

    if (result.ok) {
      await (this.migrator as any).notificationDelivery.update({
        where: { id: row.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          providerMessageId: result.providerMessageId ?? null,
          attempts: { increment: 1 },
        },
      });
      await this.audit.write({
        tenantId: row.tenantId,
        buildingId: null,
        actor: 'system',
        role: 'notifications',
        action: 'email.sent',
        entity: row.id,
        entityType: 'notification_delivery',
        building: '',
        ip: '127.0.0.1',
        sensitive: row.templateKey ? SENSITIVE_TEMPLATES.has(row.templateKey) : false,
        eventType: 'notification.delivered',
        resourceType: 'notification_delivery',
        resourceId: row.id,
        metadata: {
          channel: 'email',
          to: row.recipientAddress,
          templateKey: row.templateKey,
          providerMessageId: result.providerMessageId,
        },
      });
    } else {
      await this.markFailed(row, result.error || 'send failed', true);
    }
  }

  // Public helper for legacy in-app notifications written by domain
  // workers (e.g. PPM SLA reminder worker). Routes the write through
  // the notifications module so the SSOT contract for the `notification`
  // table holds — see ssot-ownership.test.mjs OWNERSHIP[notification].
  // INIT-010 Follow-up B (2026-04-28).
  async recordInAppNotification(input: {
    tenantId: string;
    buildingId?: string | null;
    userId: string;
    type: string;
    content: string;
  }): Promise<void> {
    await (this.migrator as any).notification.create({
      data: {
        tenantId: input.tenantId,
        buildingId: input.buildingId ?? null,
        userId: input.userId,
        type: input.type,
        content: input.content,
      },
    });
  }

  // In-app inbox delivery — write to the legacy `notifications` table
  // so the existing user-facing inbox keeps working.
  private async deliverInApp(row: any): Promise<void> {
    if (!row.recipientAddress) {
      // recipientAddress for inapp = userId (set in createDelivery).
      // No userId means the team member isn't a logged-in user — skip.
      await this.markFailed(row, 'no userId', false);
      return;
    }
    await (this.migrator as any).notification.create({
      data: {
        tenantId: row.tenantId,
        userId: row.recipientAddress,
        type: row.eventType || 'notification',
        content: row.subjectSnapshot || row.bodySnapshot?.slice(0, 200) || 'New notification',
      },
    });
    await (this.migrator as any).notificationDelivery.update({
      where: { id: row.id },
      data: { status: 'sent', sentAt: new Date(), attempts: { increment: 1 } },
    });
  }

  // Push delivery — looks up Device rows for the user and would call
  // Expo/FCM. Stub: marks sent without an actual push call (production
  // wires Expo push in a follow-up; the contract is the same).
  private async deliverPush(row: any): Promise<void> {
    if (!row.recipientAddress) {
      await this.markFailed(row, 'no userId', false);
      return;
    }
    const devices = await (this.migrator as any).device.findMany({
      where: { userId: row.recipientAddress },
      select: { id: true, pushToken: true },
    });
    if (!devices.length) {
      await this.markFailed(row, 'no devices registered', false);
      return;
    }
    // Stub — accept as sent. Production: POST to Expo / FCM here.
    await (this.migrator as any).notificationDelivery.update({
      where: { id: row.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        attempts: { increment: 1 },
        providerMessageId: `push-stub-${devices.length}`,
      },
    });
  }

  private async markFailed(row: any, error: string, retry: boolean): Promise<void> {
    const nextAttempts = (row.attempts ?? 0) + 1;
    if (!retry || nextAttempts >= row.maxAttempts) {
      await (this.migrator as any).notificationDelivery.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          attempts: nextAttempts,
          lastError: error,
        },
      });
      await this.audit.write({
        tenantId: row.tenantId,
        buildingId: null,
        actor: 'system',
        role: 'notifications',
        action: 'notification.dead_lettered',
        entity: row.id,
        entityType: 'notification_delivery',
        building: '',
        ip: '127.0.0.1',
        sensitive: true,
        eventType: 'notification.failed',
        resourceType: 'notification_delivery',
        resourceId: row.id,
        metadata: { channel: row.channel, error, attempts: nextAttempts },
      });
      return;
    }
    const backoffMs = RETRY_BACKOFF_MS[Math.min(nextAttempts, RETRY_BACKOFF_MS.length - 1)];
    await (this.migrator as any).notificationDelivery.update({
      where: { id: row.id },
      data: {
        status: 'pending',
        attempts: nextAttempts,
        lastError: error,
        scheduledAt: new Date(Date.now() + backoffMs),
      },
    });
  }

  private async findTemplate(
    tenantId: string,
    key: string,
    channel: string,
    locale: string,
  ): Promise<any | null> {
    // Tenant override takes precedence over system row.
    const rows = await (this.migrator as any).notificationTemplate.findMany({
      where: {
        OR: [{ tenantId }, { tenantId: null }],
        key,
        channel,
        locale,
      },
    });
    if (!rows.length) return null;
    return rows.find((r: any) => r.tenantId === tenantId) ?? rows[0];
  }

  // ── In-app inbox API surface ────────────────────────────────────
  async listInbox(tenantId: string, userId: string, opts: { limit?: number } = {}) {
    const items = await this.prisma.notification.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
    });
    return { total: items.length, items };
  }

  async markRead(tenantId: string, userId: string, id: string) {
    const found = await this.prisma.notification.findFirst({
      where: { id, tenantId, userId },
    });
    if (!found) return { ok: false };
    await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}

function stripHtml(s: string): string {
  if (!s) return '';
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
