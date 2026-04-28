// INIT-014 — Outbox subscribers.
//
// Connects the canonical event catalog to NotificationsService.dispatchEvent.
// Each subscriber is idempotent (event.id used as dedup component upstream).
//
// Wired in OnModuleInit so the registry has all handlers attached before
// the OutboxDispatcher starts pulling pending rows.

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OutboxRegistry } from '../events/outbox.registry';
import type { OutboxEventEnvelope } from '../events/outbox.registry';
import { NotificationsService } from './notifications.service';
import type { MailerAdapter } from './mailer.adapter';
import { MAILER } from './mailer.token';

// Events that should always trigger a notification dispatch lookup.
// Other events still flow through outbox but are ignored if no rule
// references them.
const SUBSCRIBED_EVENTS = [
  // PPM
  'ppm.task.assigned',
  'task.assigned',
  'task.due_soon',
  // Reactive
  'incident.assigned',
  'incident.created',
  'service_request.assigned',
  // Approvals
  'approval.request.pending',
  'approval.requested',
  'approval.decided',
  'approval.escalated',
  // Documents
  'document.requested',
  'document.uploaded',
  // Finance
  'invoice.awaiting_confirmation',
  'invoice.confirmed',
  // People
  'role.assigned',
  'role.revoked',
  'team_member.created',
  // Cleaning
  'cleaning.assigned',
  'cleaning.completed',
];

@Injectable()
export class NotificationsSubscribers implements OnModuleInit {
  private readonly log = new Logger('NotificationsSubscribers');

  constructor(
    private readonly registry: OutboxRegistry,
    private readonly notifications: NotificationsService,
    @Inject(MAILER) private readonly mailer: MailerAdapter,
  ) {}

  onModuleInit() {
    const handler = async (event: OutboxEventEnvelope) => {
      try {
        await this.notifications.dispatchEvent(event, this.mailer);
      } catch (e) {
        this.log.error(
          `dispatch failed event=${event.type} id=${event.id}: ${(e as Error).message}`,
        );
        throw e; // outbox dispatcher decides retry
      }
    };
    for (const t of SUBSCRIBED_EVENTS) {
      this.registry.register(t, handler);
    }
    this.log.log(`subscribed to ${SUBSCRIBED_EVENTS.length} event types`);
  }
}
