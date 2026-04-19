import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface DomainEvent {
  type: string;        // e.g. "domera.ppm.task.completed"
  source: string;      // e.g. "/domera/api/ppm"
  subject?: string;    // usually the entity id
  data: any;
  buildingId?: string;
}

/**
 * Transactional outbox writer. Call `emit()` inside the same $transaction that
 * commits the state change, so events are durable only if the write committed.
 * The delivery worker picks up pending rows and ships them to subscribers.
 */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async emit(tenantId: string, evt: DomainEvent, tx?: { outboxEvent: { create: (args: any) => Promise<any> } }) {
    const client: any = tx ?? this.prisma;
    return client.outboxEvent.create({
      data: {
        tenantId,
        buildingId: evt.buildingId || null,
        type: evt.type,
        source: evt.source,
        subject: evt.subject || null,
        data: evt.data as any,
      },
    });
  }

  async list(tenantId: string, params: { status?: string; type?: string; take?: number }) {
    const take = Math.min(Math.max(params.take || 50, 1), 500);
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.type) where.type = params.type;
    return this.prisma.outboxEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  }
}
