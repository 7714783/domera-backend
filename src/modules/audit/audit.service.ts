import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditEntry } from './audit.types';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<AuditEntry[]> {
    const items = await this.prisma.auditEntry.findMany({
      where: { tenantId },
      orderBy: { timestamp: 'desc' },
      take: 200,
    });

    return items.map((entry) => ({
      id: entry.id,
      tenantId: entry.tenantId,
      timestamp: entry.timestamp.toISOString(),
      actor: entry.actor,
      role: entry.role,
      action: entry.action,
      entity: entry.entity,
      entityType: entry.entityType,
      building: entry.building,
      ip: entry.ip,
      sensitive: entry.sensitive,
    }));
  }

  async search(
    tenantId: string,
    params: {
      q?: string;
      actor?: string;
      action?: string;
      entityType?: string;
      sensitiveOnly?: boolean;
      from?: string;
      to?: string;
      take?: number;
      skip?: number;
    },
  ) {
    const take = Math.min(Math.max(params.take || 100, 1), 500);
    const skip = Math.max(params.skip || 0, 0);
    const where: any = { tenantId };
    if (params.actor) where.actor = params.actor;
    if (params.action) where.action = params.action;
    if (params.entityType) where.entityType = params.entityType;
    if (params.sensitiveOnly) where.sensitive = true;
    if (params.from || params.to) {
      where.timestamp = {};
      if (params.from) where.timestamp.gte = new Date(params.from);
      if (params.to) where.timestamp.lte = new Date(params.to);
    }
    if (params.q) {
      where.OR = [
        { actor: { contains: params.q, mode: 'insensitive' } },
        { action: { contains: params.q, mode: 'insensitive' } },
        { entity: { contains: params.q, mode: 'insensitive' } },
        { entityType: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.auditEntry.findMany({ where, take, skip, orderBy: { timestamp: 'desc' } }),
      this.prisma.auditEntry.count({ where }),
    ]);
    return { total, items };
  }

  async exportCsv(
    tenantId: string,
    params: Parameters<AuditService['search']>[1],
  ): Promise<string> {
    const r = await this.search(tenantId, { ...params, take: 500, skip: params.skip || 0 });
    const headers = [
      'id',
      'timestamp',
      'actor',
      'role',
      'action',
      'entityType',
      'entity',
      'building',
      'ip',
      'sensitive',
    ];
    const esc = (v: unknown) => {
      if (v == null) return '';
      const s = typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const e of r.items) {
      lines.push(
        [
          e.id,
          e.timestamp.toISOString(),
          e.actor,
          e.role,
          e.action,
          e.entityType,
          e.entity,
          e.building,
          e.ip,
          String(e.sensitive),
        ]
          .map(esc)
          .join(','),
      );
    }
    return lines.join('\n');
  }

  // INIT-010 P0-3 — single helper for state transitions on regulated data.
  //
  // Replaces the ad-hoc audit.write() boilerplate that was inconsistently
  // applied (or missing) across approvals/reactive/ppm/cleaning. Every
  // sensitive `prisma.*.update({status: ...})` should call transition()
  // immediately after committing the state change. Module-level history
  // tables (cleaning_request_history etc.) stay — they are domain-specific
  // detail; audit_entries is the universal compliance trail.
  //
  // Args:
  //   tenantId      — RLS scope
  //   actor         — userId (or 'system' / 'job-runner' for non-user paths)
  //   actorRole     — best-effort role label for the audit row
  //   entityType    — Prisma model name in lower_snake (e.g. 'incident',
  //                   'ppm_case', 'cleaning_request', 'approval_request')
  //   entityId      — primary key of the row that changed
  //   from          — prior status string (or null on initial create)
  //   to            — new status string
  //   buildingId    — optional building scope
  //   metadata      — anything else worth persisting (reason, evidenceIds, …)
  async transition(args: {
    tenantId: string;
    actor: string;
    actorRole: string;
    entityType: string;
    entityId: string;
    from: string | null;
    to: string;
    buildingId?: string | null;
    metadata?: Record<string, unknown>;
    sensitive?: boolean;
  }): Promise<AuditEntry> {
    return this.write({
      tenantId: args.tenantId,
      buildingId: args.buildingId ?? null,
      actor: args.actor,
      role: args.actorRole,
      action: `${args.entityType}.${args.from ?? 'init'}_to_${args.to}`,
      entity: args.entityId,
      entityType: args.entityType,
      building: args.buildingId ?? '',
      ip: '127.0.0.1',
      sensitive: args.sensitive ?? true,
      eventType: `${args.entityType}.transition`,
      resourceType: args.entityType,
      resourceId: args.entityId,
      metadata: { from: args.from, to: args.to, ...(args.metadata ?? {}) },
    });
  }

  async write(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const created = await this.prisma.auditEntry.create({
      data: {
        tenantId: entry.tenantId,
        buildingId: entry.buildingId ?? null,
        actor: entry.actor,
        role: entry.role,
        action: entry.action,
        entity: entry.entity,
        entityType: entry.entityType,
        building: entry.building,
        ip: entry.ip,
        sensitive: entry.sensitive,
        eventType: entry.eventType ?? null,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        metadata: (entry.metadata ?? undefined) as any,
      },
    });

    return {
      id: created.id,
      tenantId: created.tenantId,
      timestamp: created.timestamp.toISOString(),
      actor: created.actor,
      role: created.role,
      action: created.action,
      entity: created.entity,
      entityType: created.entityType,
      building: created.building,
      ip: created.ip,
      sensitive: created.sensitive,
      buildingId: created.buildingId,
      eventType: created.eventType,
      resourceType: created.resourceType,
      resourceId: created.resourceId,
      metadata: created.metadata as any,
    };
  }
}
