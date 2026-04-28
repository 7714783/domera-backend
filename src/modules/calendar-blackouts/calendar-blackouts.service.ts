import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const KINDS = ['weekend', 'holiday', 'freeze', 'custom'];
const POLICIES = ['shift', 'skip', 'defer_to_next_working_day'];

@Injectable()
export class CalendarBlackoutsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, buildingId?: string) {
    const where: any = { tenantId };
    if (buildingId) where.OR = [{ buildingId: null }, { buildingId }];
    return this.prisma.calendarBlackout.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { dayOfWeek: 'asc' }, { startDate: 'asc' }],
    });
  }

  async create(
    tenantId: string,
    body: {
      buildingId?: string;
      kind: string;
      label: string;
      dayOfWeek?: number;
      startDate?: string;
      endDate?: string;
      annualRecurring?: boolean;
      policy?: string;
      isActive?: boolean;
    },
  ) {
    if (!body.kind || !body.label) throw new BadRequestException('kind and label required');
    if (!KINDS.includes(body.kind))
      throw new BadRequestException(`kind must be one of ${KINDS.join(', ')}`);
    if (body.policy && !POLICIES.includes(body.policy)) {
      throw new BadRequestException(`policy must be one of ${POLICIES.join(', ')}`);
    }
    if (body.dayOfWeek !== undefined && (body.dayOfWeek < 0 || body.dayOfWeek > 6)) {
      throw new BadRequestException('dayOfWeek must be 0..6');
    }
    if (body.dayOfWeek === undefined && !body.startDate) {
      throw new BadRequestException(
        'provide dayOfWeek for weekly, or startDate for one-shot/annual',
      );
    }
    return this.prisma.calendarBlackout.create({
      data: {
        tenantId,
        buildingId: body.buildingId || null,
        kind: body.kind,
        label: body.label,
        dayOfWeek: body.dayOfWeek ?? null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        annualRecurring: !!body.annualRecurring,
        policy: body.policy || 'defer_to_next_working_day',
        isActive: body.isActive ?? true,
      },
    });
  }

  async delete(tenantId: string, id: string) {
    const row = await this.prisma.calendarBlackout.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('blackout not found');
    await this.prisma.calendarBlackout.delete({ where: { id } });
    return { ok: true };
  }

  async seedIsraelDefaults(tenantId: string, buildingId?: string) {
    // Local weekend = Saturday (dayOfWeek=6).
    const saturday = await this.prisma.calendarBlackout.upsert({
      where: { id: `seed-il-sat-${tenantId}-${buildingId || 'all'}` },
      create: {
        id: `seed-il-sat-${tenantId}-${buildingId || 'all'}`,
        tenantId,
        buildingId: buildingId || null,
        kind: 'weekend',
        label: 'Shabbat (Saturday)',
        dayOfWeek: 6,
        policy: 'defer_to_next_working_day',
        isActive: true,
      },
      update: {},
    });
    return { created: 1, items: [saturday] };
  }
}
