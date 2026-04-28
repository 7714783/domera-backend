import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const ALLOWED_TARGETS = ['purchase_order', 'work_order', 'completion', 'task_instance', 'quote'];
const RATIFICATION_WINDOW_HOURS: Record<string, number> = { P1: 24, P2: 72 };

@Injectable()
export class EmergencyOverridesService {
  constructor(private readonly prisma: PrismaService) {}

  async invoke(
    tenantId: string,
    actorUserId: string,
    body: {
      buildingId: string;
      targetType: string;
      targetId: string;
      reason: string;
      severity?: string;
    },
  ) {
    if (!body.buildingId || !body.targetType || !body.targetId || !body.reason) {
      throw new BadRequestException('buildingId, targetType, targetId, reason required');
    }
    if (!ALLOWED_TARGETS.includes(body.targetType)) {
      throw new BadRequestException(`targetType must be one of ${ALLOWED_TARGETS.join(', ')}`);
    }
    const severity = body.severity || 'P1';
    const hours = RATIFICATION_WINDOW_HOURS[severity] ?? 24;
    return this.prisma.emergencyOverride.create({
      data: {
        tenantId,
        buildingId: body.buildingId,
        targetType: body.targetType,
        targetId: body.targetId,
        reason: body.reason,
        severity,
        invokedByUserId: actorUserId,
        ratificationDueBy: new Date(Date.now() + hours * 3600000),
      },
    });
  }

  async ratify(
    tenantId: string,
    actorUserId: string,
    id: string,
    decision: 'ratified' | 'rejected',
    notes?: string,
  ) {
    const ov = await this.prisma.emergencyOverride.findFirst({ where: { id, tenantId } });
    if (!ov) throw new NotFoundException('override not found');
    if (ov.status !== 'pending_ratification')
      throw new BadRequestException(`already in status ${ov.status}`);
    if (ov.invokedByUserId === actorUserId) {
      throw new ForbiddenException('SoD: invoker and ratifier must differ');
    }
    return this.prisma.emergencyOverride.update({
      where: { id },
      data: {
        status: decision,
        ratifiedByUserId: actorUserId,
        ratifiedAt: new Date(),
        ratificationNotes: notes || null,
      },
    });
  }

  async markLapsed() {
    const now = new Date();
    const r = await this.prisma.emergencyOverride.updateMany({
      where: { status: 'pending_ratification', ratificationDueBy: { lt: now } },
      data: { status: 'lapsed' },
    });
    return { lapsed: r.count };
  }

  async list(tenantId: string, params: { status?: string; buildingId?: string }) {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.buildingId) where.buildingId = params.buildingId;
    return this.prisma.emergencyOverride.findMany({
      where,
      orderBy: [{ status: 'asc' }, { invokedAt: 'desc' }],
      take: 100,
    });
  }

  async isActive(tenantId: string, targetType: string, targetId: string): Promise<boolean> {
    const ov = await this.prisma.emergencyOverride.findFirst({
      where: {
        tenantId,
        targetType,
        targetId,
        status: { in: ['pending_ratification', 'ratified'] },
      },
    });
    return !!ov;
  }
}
