// INIT-012 Phase 2 — outbox subscriber registry.
//
// Modules that consume cross-module events register a handler against
// the event type string here. The dispatcher (in-process v1) reads
// pending OutboxEvent rows, looks up handlers by type, and invokes them.
//
// Subscribers MUST be idempotent — at-least-once delivery means a
// handler can fire multiple times for the same event (process restart,
// retry on transient failure). Use the event id as the dedup key.

import { Injectable, Logger } from '@nestjs/common';

export interface OutboxEventEnvelope {
  id: string; // event id — use as idempotency dedup key
  tenantId: string;
  buildingId: string | null;
  type: string;
  source: string;
  subject: string | null;
  payload: Record<string, unknown>;
}

export type OutboxHandler = (event: OutboxEventEnvelope) => Promise<void>;

@Injectable()
export class OutboxRegistry {
  private readonly log = new Logger('OutboxRegistry');
  private readonly handlers = new Map<string, OutboxHandler[]>();

  register(eventType: string, handler: OutboxHandler) {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
    this.log.debug(`registered handler for ${eventType} (now ${list.length})`);
  }

  handlersFor(eventType: string): OutboxHandler[] {
    return this.handlers.get(eventType) ?? [];
  }

  // Useful for tests / introspection.
  knownTypes(): string[] {
    return [...this.handlers.keys()].sort();
  }
}
