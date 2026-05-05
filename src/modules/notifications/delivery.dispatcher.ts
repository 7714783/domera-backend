// INIT-014 — Delivery dispatcher.
//
// In-process polling worker, mirrors the OutboxDispatcher pattern.
// Picks pending NotificationDelivery rows every NOTIFY_POLL_INTERVAL_MS,
// invokes NotificationsService.processPending() which handles channel-
// specific send + retry + dead-letter.
//
// At-least-once + idempotency via dedupKey in createDelivery().
// Ready to swap for BullMQ when Redis lands; the API surface
// (processPending) doesn't change.

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { MailerAdapter } from './mailer.adapter';
import { MAILER } from './mailer.token';

const POLL_INTERVAL_MS = Number(process.env.NOTIFY_POLL_INTERVAL_MS || 5000);
const BATCH_SIZE = Number(process.env.NOTIFY_BATCH_SIZE || 25);

@Injectable()
export class DeliveryDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('DeliveryDispatcher');
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly notifications: NotificationsService,
    @Inject(MAILER) private readonly mailer: MailerAdapter,
  ) {}

  onModuleInit() {
    // NS-25 — OPENAPI_GEN_MODE skips background timers so the spec
    // generator can exit cleanly without dangling intervals.
    if (process.env.OPENAPI_GEN_MODE === '1') return;
    if (process.env.NOTIFY_DISABLE === '1') {
      this.log.warn('Delivery dispatcher disabled via NOTIFY_DISABLE=1');
      return;
    }
    this.log.log(
      `delivery dispatcher polling every ${POLL_INTERVAL_MS}ms, batch=${BATCH_SIZE}, mailer=${this.mailer.providerName}`,
    );
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { processed } = await this.notifications.processPending(this.mailer, BATCH_SIZE);
      if (processed > 0) {
        this.log.debug(`processed ${processed} delivery row(s)`);
      }
    } catch (e) {
      this.log.error(`tick failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
