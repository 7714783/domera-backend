import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PpmService } from '../ppm/ppm.service';
import { CONDITION_OPERATORS, thresholdMet } from './condition-triggers.logic';

const OPERATORS = [...CONDITION_OPERATORS];

@Injectable()
export class ConditionTriggersService {
  // INIT-010 P0-1 — TaskInstance is owned by PpmService; condition-triggers
  // routes its creation through PpmService.createTaskFromTrigger() instead of
  // a direct prisma.taskInstance.create call. When the outbox pattern lands
  // (INIT-010 Phase 7), this DI dependency is replaced by a `condition.triggered`
  // event published here and consumed by ppm.
  constructor(
    private readonly prisma: PrismaService,
    private readonly ppm: PpmService,
  ) {}

  async list(tenantId: string, buildingId?: string) {
    const where: any = { tenantId };
    if (buildingId) where.buildingId = buildingId;
    return this.prisma.conditionTrigger.findMany({ where, orderBy: { name: 'asc' } });
  }

  async create(
    tenantId: string,
    body: {
      buildingId: string;
      sensorPointId: string;
      templateId: string;
      name: string;
      operator: string;
      threshold: number;
      unit?: string;
      cooldownMinutes?: number;
      isActive?: boolean;
    },
  ) {
    if (
      !body.buildingId ||
      !body.sensorPointId ||
      !body.templateId ||
      !body.name ||
      !body.operator ||
      body.threshold === undefined
    ) {
      throw new BadRequestException(
        'buildingId, sensorPointId, templateId, name, operator, threshold required',
      );
    }
    if (!OPERATORS.includes(body.operator)) {
      throw new BadRequestException(`operator must be one of ${OPERATORS.join(', ')}`);
    }
    const sensor = await this.prisma.sensorPoint.findFirst({
      where: { id: body.sensorPointId, tenantId, buildingId: body.buildingId },
    });
    if (!sensor) throw new NotFoundException('sensor point not found in this building');
    const template = await this.prisma.ppmTemplate.findFirst({
      where: { id: body.templateId, tenantId, buildingId: body.buildingId },
    });
    if (!template) throw new NotFoundException('PPM template not found in this building');
    return this.prisma.conditionTrigger.create({
      data: {
        tenantId,
        buildingId: body.buildingId,
        sensorPointId: body.sensorPointId,
        templateId: body.templateId,
        name: body.name,
        operator: body.operator,
        threshold: body.threshold,
        unit: body.unit || null,
        cooldownMinutes: body.cooldownMinutes ?? 60,
        isActive: body.isActive ?? true,
      },
    });
  }

  /**
   * Evaluate a sensor reading against any active triggers bound to that sensor.
   * Spawns a TaskInstance (lifecycleStage=scheduled) for each fired trigger,
   * respecting per-trigger cooldown. Writes a ConditionEvent for every reading
   * (whether it matched, was deduped, or no-op).
   */
  async evaluateReading(
    tenantId: string,
    body: {
      sensorPointId: string;
      value: number;
      readingAt?: string;
    },
  ) {
    if (!body.sensorPointId || body.value === undefined) {
      throw new BadRequestException('sensorPointId and value required');
    }
    const sensor = await this.prisma.sensorPoint.findFirst({
      where: { id: body.sensorPointId, tenantId },
    });
    if (!sensor) throw new NotFoundException('sensor not found');

    const triggers = await this.prisma.conditionTrigger.findMany({
      where: { tenantId, sensorPointId: body.sensorPointId, isActive: true },
    });
    const readingAt = body.readingAt ? new Date(body.readingAt) : new Date();
    const events: Array<{ triggerId: string; action: string; taskInstanceId?: string }> = [];

    for (const t of triggers) {
      const met = thresholdMet(t.operator, body.value, t.threshold, t.lastReadingValue);
      if (!met) {
        const ev = await this.prisma.conditionEvent.create({
          data: {
            tenantId,
            buildingId: sensor.buildingId,
            triggerId: t.id,
            sensorPointId: sensor.id,
            readingValue: body.value,
            readingAt,
            action: 'threshold_not_met',
          },
        });
        await this.prisma.conditionTrigger.update({
          where: { id: t.id },
          data: { lastReadingValue: body.value },
        });
        events.push({ triggerId: t.id, action: 'threshold_not_met' });
        continue;
      }

      const cooldownMs = t.cooldownMinutes * 60000;
      if (t.lastFiredAt && readingAt.getTime() - t.lastFiredAt.getTime() < cooldownMs) {
        await this.prisma.conditionEvent.create({
          data: {
            tenantId,
            buildingId: sensor.buildingId,
            triggerId: t.id,
            sensorPointId: sensor.id,
            readingValue: body.value,
            readingAt,
            action: 'deduped_cooldown',
            notes: `last fired ${t.lastFiredAt.toISOString()}, cooldown ${t.cooldownMinutes}min`,
          },
        });
        await this.prisma.conditionTrigger.update({
          where: { id: t.id },
          data: { lastReadingValue: body.value },
        });
        events.push({ triggerId: t.id, action: 'deduped_cooldown' });
        continue;
      }

      // INIT-010 P0-1 — delegate to ppm (the owner of TaskInstance).
      const task = await this.ppm.createTaskFromTrigger({
        tenantId,
        buildingId: sensor.buildingId,
        templateId: t.templateId,
        title: `${t.name} (condition: ${body.value}${t.unit || ''} ${t.operator} ${t.threshold})`,
        dueAt: readingAt,
      });
      await this.prisma.conditionEvent.create({
        data: {
          tenantId,
          buildingId: sensor.buildingId,
          triggerId: t.id,
          sensorPointId: sensor.id,
          readingValue: body.value,
          readingAt,
          action: 'spawned_task',
          taskInstanceId: task.id,
        },
      });
      await this.prisma.conditionTrigger.update({
        where: { id: t.id },
        data: { lastFiredAt: readingAt, lastReadingValue: body.value },
      });
      events.push({ triggerId: t.id, action: 'spawned_task', taskInstanceId: task.id });
    }

    return { sensorPointId: sensor.id, evaluatedTriggers: triggers.length, events };
  }

  async listEvents(
    tenantId: string,
    params: { triggerId?: string; sensorPointId?: string; action?: string; take?: number },
  ) {
    const take = Math.min(Math.max(params.take || 50, 1), 500);
    const where: any = { tenantId };
    if (params.triggerId) where.triggerId = params.triggerId;
    if (params.sensorPointId) where.sensorPointId = params.sensorPointId;
    if (params.action) where.action = params.action;
    return this.prisma.conditionEvent.findMany({ where, take, orderBy: { readingAt: 'desc' } });
  }
}
