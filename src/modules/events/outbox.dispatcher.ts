// INIT-012 Phase 2 — outbox dispatcher (in-process v1).
//
// Reads pending OutboxEvent rows and fans them out to registered handlers.
// At-least-once delivery: a handler that throws keeps the row in `pending`
// and increments `attempts`; the worker retries until it succeeds or hits
// the max-attempts ceiling, then marks `failed`.
//
// V1 runs in-process via setInterval. When the workload outgrows that
// (multi-instance Railway, mass fan-out) replace this dispatcher with a
// BullMQ worker without touching producer or subscriber code.
//
// Subscribers register themselves at module init via OutboxRegistry.
// Each subscriber is `(event) => Promise<void>`. Subscribers MUST be
// idempotent — at-least-once delivery means duplicates can occur on
// retry / process restart.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MigratorPrismaService } from '../../prisma/prisma.migrator';
import { OutboxRegistry, type OutboxHandler } from './outbox.registry';

const POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS || 5_000);
const BATCH_SIZE = Number(process.env.OUTBOX_BATCH_SIZE || 50);
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS || 5);
const ENABLED = (process.env.OUTBOX_DISPATCHER_ENABLED || 'true').toLowerCase() === 'true';

interface OutboxRow {
  id: string;
  tenantId: string;
  buildingId: string | null;
  type: string;
  source: string;
  subject: string | null;
  data: any;
  attempts: number;
}

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OutboxDispatcher');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly migrator: MigratorPrismaService,
    private readonly registry: OutboxRegistry,
  ) {}

  onModuleInit() {
    if (!ENABLED) {
      this.log.log('OUTBOX_DISPATCHER_ENABLED=false — dispatcher idle');
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log.warn(`tick failed: ${e?.message ?? e}`));
    }, POLL_INTERVAL_MS);
    this.log.log(`outbox dispatcher polling every ${POLL_INTERVAL_MS}ms`);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Wait briefly for an in-flight tick to finish.
    for (let i = 0; i < 20 && this.running; i++) await sleep(50);
  }

  // Exported for tests + manual runs.
  async tick(): Promise<{ processed: number; failed: number }> {
    if (this.running) return { processed: 0, failed: 0 };
    this.running = true;
    try {
      // Read with the migrator client — pending rows belong to many tenants;
      // RLS-wrapped client would filter to the empty tenant context.
      const rows = await this.migrator.outboxEvent.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
        select: {
          id: true,
          tenantId: true,
          buildingId: true,
          type: true,
          source: true,
          subject: true,
          data: true,
          attempts: true,
        },
      });

      let processed = 0;
      let failed = 0;
      for (const row of rows as OutboxRow[]) {
        const handlers = this.registry.handlersFor(row.type);
        if (handlers.length === 0) {
          // No subscriber yet — mark delivered so the row doesn't poll forever.
          // Add the handler later and a fresh event will be picked up.
          await this.markDelivered(row.id);
          processed++;
          continue;
        }
        const ok = await this.dispatchAll(row, handlers);
        if (ok) {
          await this.markDelivered(row.id);
          processed++;
        } else {
          await this.markRetryOrFailed(row);
          failed++;
        }
      }
      return { processed, failed };
    } finally {
      this.running = false;
    }
  }

  private async dispatchAll(row: OutboxRow, handlers: OutboxHandler[]): Promise<boolean> {
    let allOk = true;
    for (const handler of handlers) {
      try {
        await handler({
          id: row.id,
          tenantId: row.tenantId,
          buildingId: row.buildingId,
          type: row.type,
          source: row.source,
          subject: row.subject,
          payload: row.data ?? {},
        });
      } catch (e: any) {
        this.log.warn(
          `handler failed for ${row.type} (event ${row.id}): ${e?.message ?? e}`,
        );
        allOk = false;
      }
    }
    return allOk;
  }

  private markDelivered(id: string) {
    return this.migrator.outboxEvent.update({
      where: { id },
      data: { status: 'delivered', deliveredAt: new Date() },
    });
  }

  private markRetryOrFailed(row: OutboxRow) {
    const next = row.attempts + 1;
    const data: any = { attempts: next, lastAttemptAt: new Date() };
    if (next >= MAX_ATTEMPTS) {
      data.status = 'failed';
      data.lastError = `max attempts (${MAX_ATTEMPTS}) exhausted`;
    }
    return this.migrator.outboxEvent.update({ where: { id: row.id }, data });
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
