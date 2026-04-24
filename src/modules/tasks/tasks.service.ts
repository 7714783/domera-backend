import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Mobile-facing task lifecycle. Every mutation is a single-column update on
 * the existing TaskInstance row — no new tables, no migration. Tenant
 * isolation is enforced by PrismaService $extends auto-wrap (RLS policies
 * still filter every read/write).
 *
 * Status domain:
 *   open → in_progress → (paused ↔ in_progress) → completed
 *                      → cancelled
 *
 * INIT-002 Phase 5 P1 — add-note endpoint is deferred to a follow-up (needs
 * a separate TaskNote model + migration).
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    opts: { assignee?: 'me'; status?: string; buildingId?: string; limit?: number },
    actorUserId: string,
  ) {
    // `assignee=me` filters by performer-org membership OR assigned user in
    // future; for now it narrows to tasks whose building_role_assignments
    // include the caller. For v1 simplicity we only honour buildingId +
    // status filters — the mobile client always passes at least buildingId.
    const where: any = { tenantId };
    if (opts.buildingId) where.buildingId = opts.buildingId;
    if (opts.status) where.status = opts.status;
    const items = await this.prisma.taskInstance.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      take: Math.min(opts.limit ?? 100, 200),
      select: {
        id: true,
        title: true,
        status: true,
        lifecycleStage: true,
        dueAt: true,
        completedAt: true,
        buildingId: true,
        planItemId: true,
        evidenceRequired: true,
      },
    });
    // Caller id is recorded so callers who are not members of the tenant are
    // already filtered out by tenant-middleware; this arg exists so future
    // assignee-filter work has the signature in place.
    void actorUserId;
    return { total: items.length, items };
  }

  async get(tenantId: string, id: string) {
    const t = await this.prisma.taskInstance.findFirst({ where: { id, tenantId } });
    if (!t) throw new NotFoundException('task not found');
    return t;
  }

  private async transition(
    tenantId: string,
    id: string,
    actorUserId: string,
    nextStatus: 'in_progress' | 'paused' | 'completed' | 'cancelled',
    allowedFrom: readonly string[],
    extra: Record<string, any> = {},
  ) {
    const task = await this.prisma.taskInstance.findFirst({
      where: { id, tenantId },
      include: { building: { select: { name: true } } },
    });
    if (!task) throw new NotFoundException('task not found');
    if (!allowedFrom.includes(task.status)) {
      throw new ForbiddenException(
        `cannot transition from ${task.status} to ${nextStatus} (allowed from: ${allowedFrom.join(', ')})`,
      );
    }
    const updated = await this.prisma.taskInstance.update({
      where: { id: task.id },
      data: { status: nextStatus, ...extra },
    });
    await this.audit.write({
      tenantId,
      buildingId: task.buildingId,
      actor: actorUserId,
      role: 'member',
      action: `Task ${nextStatus}`,
      entity: task.title,
      entityType: 'task',
      building: task.building?.name ?? '',
      ip: '0.0.0.0',
      sensitive: false,
      eventType: `task.${nextStatus}`,
      resourceType: 'task',
      resourceId: updated.id,
    });
    return updated;
  }

  start(tenantId: string, id: string, actor: string) {
    return this.transition(tenantId, id, actor, 'in_progress', ['open', 'paused'], {
      lifecycleStage: 'started',
    });
  }

  pause(tenantId: string, id: string, actor: string) {
    return this.transition(tenantId, id, actor, 'paused', ['in_progress'], {
      lifecycleStage: 'paused',
    });
  }

  resume(tenantId: string, id: string, actor: string) {
    return this.transition(tenantId, id, actor, 'in_progress', ['paused'], {
      lifecycleStage: 'started',
    });
  }

  async complete(
    tenantId: string,
    id: string,
    actor: string,
    body?: { result?: string; evidenceDocuments?: any[] },
  ) {
    const task = await this.prisma.taskInstance.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException('task not found');
    if (
      task.evidenceRequired &&
      (!body?.evidenceDocuments || body.evidenceDocuments.length === 0)
    ) {
      throw new BadRequestException('evidence required');
    }
    return this.transition(tenantId, id, actor, 'completed', ['open', 'in_progress', 'paused'], {
      lifecycleStage: 'completed',
      completedAt: new Date(),
      completedByUserId: actor,
      result: body?.result ?? 'passed',
      evidenceDocuments: body?.evidenceDocuments ?? task.evidenceDocuments ?? [],
    });
  }

  // INIT-002 Phase 5 P1 — short on-site notes attached to a task. The mobile
  // technician posts updates ("part replaced", "customer not home"), the web
  // manager reads them in the task detail. No threading, no mentions.
  async addNote(
    tenantId: string,
    taskId: string,
    actorUserId: string,
    body: { body?: string },
  ) {
    const text = body?.body?.trim();
    if (!text) throw new BadRequestException('body required');
    if (text.length > 4000) throw new BadRequestException('body must be <= 4000 chars');
    const task = await this.prisma.taskInstance.findFirst({ where: { id: taskId, tenantId } });
    if (!task) throw new NotFoundException('task not found');
    return this.prisma.taskNote.create({
      data: {
        tenantId,
        taskInstanceId: task.id,
        authorUserId: actorUserId,
        body: text,
      },
    });
  }

  async listNotes(tenantId: string, taskId: string) {
    const task = await this.prisma.taskInstance.findFirst({ where: { id: taskId, tenantId } });
    if (!task) throw new NotFoundException('task not found');
    const notes = await this.prisma.taskNote.findMany({
      where: { taskInstanceId: task.id, tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return { total: notes.length, items: notes };
  }
}
