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

  async write(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const created = await this.prisma.auditEntry.create({
      data: {
        tenantId: entry.tenantId,
        actor: entry.actor,
        role: entry.role,
        action: entry.action,
        entity: entry.entity,
        entityType: entry.entityType,
        building: entry.building,
        ip: entry.ip,
        sensitive: entry.sensitive,
        buildingRef: undefined,
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
    };
  }
}

