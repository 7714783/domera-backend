// INIT-012 Phase 2 — outbox publisher.
//
// Producer side of the cross-module event pipeline. Every module that
// emits events declared in apps/api/test/event-contract.test.mjs CATALOG
// calls `OutboxService.publish(tx, event)` inside the same Prisma
// transaction as the state change. Atomicity guarantees that the event
// row lands in the DB iff the originating change committed.
//
// Phase 2 ships the WRITE side. The READ side (worker that fans events
// out to subscribers) lives in OutboxDispatcher — same module — and runs
// in-process for now. A BullMQ-backed worker can replace it later
// without changing producer call-sites.

import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

export type OutboxPayload = Record<string, unknown> & { tenantId: string };

export interface OutboxEventSpec {
  type: string; // e.g. 'asset.created' — must exist in CATALOG
  payload: OutboxPayload; // tenantId mandatory; rest per CATALOG payloadShape
  source: string; // module name — 'assets', 'ppm', etc.
  subject?: string; // entity id (asset id, case id, etc.)
  buildingId?: string;
  specversion?: string; // CloudEvents — defaults to '1.0'
  schemaVersion?: number; // matches CATALOG entry — defaults to 1
}

// Subset of PrismaClient that covers `outboxEvent.create`. Lets the
// service accept either a `prisma.$transaction(tx => ...)` callback
// param OR the top-level PrismaService (when no transaction is open).
type AnyTx = Pick<PrismaClient, 'outboxEvent'> | Prisma.TransactionClient;

@Injectable()
export class OutboxService {
  // Publish an event into the outbox. Pass a transaction client when the
  // caller is mid-Prisma-transaction so the row is rolled back if the
  // transaction aborts.
  async publish(tx: AnyTx, spec: OutboxEventSpec) {
    if (!spec.payload?.tenantId) {
      throw new Error(
        `OutboxService.publish: payload.tenantId is required for type=${spec.type}`,
      );
    }
    return (tx as any).outboxEvent.create({
      data: {
        tenantId: spec.payload.tenantId,
        buildingId: spec.buildingId ?? null,
        type: spec.type,
        source: spec.source,
        subject: spec.subject ?? null,
        specversion: spec.specversion ?? '1.0',
        time: new Date(),
        data: {
          schemaVersion: spec.schemaVersion ?? 1,
          ...spec.payload,
        } as any,
        status: 'pending',
        attempts: 0,
      },
    });
  }
}
