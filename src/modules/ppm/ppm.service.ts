import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { approxMonths, nextAfter, addMonthsUtc } from './engine/recurrence';
import { applyBlackouts, BlackoutRule } from './engine/blackout';

/**
 * Lifecycle stages for PPM executions (TaskInstance).
 *
 * - in_house:          scheduled → in_progress → completed → archived
 * - contracted:        scheduled → in_progress → completed → archived
 * - ad_hoc_approved:   scheduled → quote_requested → quote_received → awaiting_approval → approved → ordered
 *                      → in_progress → completed → evidence_distributed → archived
 */
const ALL_STAGES = [
  'scheduled', 'quote_requested', 'quote_received', 'awaiting_approval', 'approved',
  'ordered', 'in_progress', 'completed', 'evidence_distributed', 'archived', 'cancelled',
];

/** Months between steps (used for UI + fallback when rrule parse fails). */
function rruleMonths(rule: string, fallbackMonths: number | null): number {
  return approxMonths(rule, fallbackMonths ?? 12);
}

/** Compute next occurrence after a reference date, using the real rrule engine. */
function addMonths(from: Date, months: number): Date {
  return addMonthsUtc(from, months);
}

/**
 * Next-due calculation:
 *  1. Prefer the rrule `.after()` result if the rule parses.
 *  2. Otherwise fall back to `approxMonths` arithmetic.
 */
function nextDueFrom(rule: string, from: Date, fallbackMonths: number | null): Date {
  const real = nextAfter(rule, from);
  if (real) return real;
  const months = approxMonths(rule, fallbackMonths ?? 12);
  return addMonthsUtc(from, Math.max(months, 0.5));
}

@Injectable()
export class PpmService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadBlackouts(tenantId: string, buildingId: string): Promise<BlackoutRule[]> {
    const rows = await this.prisma.calendarBlackout.findMany({
      where: {
        tenantId, isActive: true,
        OR: [{ buildingId: null }, { buildingId }],
      },
    });
    return rows.map((r) => ({
      id: r.id, kind: r.kind, label: r.label,
      dayOfWeek: r.dayOfWeek, startDate: r.startDate, endDate: r.endDate,
      annualRecurring: r.annualRecurring, policy: r.policy as any,
      isActive: r.isActive, buildingId: r.buildingId,
    }));
  }

  private async requireManager(tenantId: string, actorUserId: string) {
    const ws = await this.prisma.membership.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: { in: ['workspace_owner', 'workspace_admin', 'org_admin'] } },
    });
    if (ws) return;
    const br = await this.prisma.buildingRoleAssignment.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: { in: ['building_manager', 'chief_engineer', 'maintenance_coordinator'] } },
    });
    if (!br) throw new ForbiddenException('not authorized');
  }

  private async resolveBuildingId(tenantId: string, idOrSlug: string): Promise<string> {
    const b = await this.prisma.building.findFirst({
      where: { tenantId, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      select: { id: true },
    });
    if (!b) throw new NotFoundException('building not found');
    return b.id;
  }

  async listPrograms(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const items = await this.prisma.ppmTemplate.findMany({
      where: { tenantId, buildingId },
      include: {
        planItems: {
          include: { obligation: { select: { name: true, domain: true, requiredDocumentTypeKey: true } } },
        },
      },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
    });
    const orgIds = [...new Set(items.map((x) => x.performerOrgId).filter((x): x is string => !!x))];
    const orgs = orgIds.length
      ? await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, type: true } })
      : [];
    const orgById = new Map(orgs.map((o) => [o.id, o]));
    return items.map((t) => {
      const nextDue = t.planItems
        .map((p) => p.nextDueAt)
        .sort((a, b) => a.getTime() - b.getTime())[0] || null;
      const lastDone = t.planItems
        .map((p) => p.lastPerformedAt)
        .filter((x): x is Date => !!x)
        .sort((a, b) => b.getTime() - a.getTime())[0] || null;
      return {
        id: t.id, name: t.name, description: t.description, domain: t.domain,
        scope: t.scope, executionMode: t.executionMode,
        performerOrg: t.performerOrgId ? orgById.get(t.performerOrgId) : null,
        contractId: t.contractId,
        requiresApprovalBeforeOrder: t.requiresApprovalBeforeOrder,
        frequencyMonths: t.frequencyMonths,
        evidenceDocTypeKey: t.evidenceDocTypeKey,
        assignedRole: t.assignedRole,
        planItemsCount: t.planItems.length,
        nextDueAt: nextDue,
        lastPerformedAt: lastDone,
      };
    });
  }

  async createProgram(tenantId: string, actorUserId: string, buildingIdOrSlug: string, body: {
    obligationTemplateId: string;
    name?: string;
    description?: string;
    domain?: string;
    scope?: 'building_common' | 'unit_scoped';
    executionMode: 'in_house' | 'contracted' | 'ad_hoc_approved';
    performerOrgId?: string;
    contractId?: string;
    unitId?: string;
    frequencyMonths?: number;
    recurrenceRule?: string;
    evidenceDocTypeKey?: string;
    assignedRole?: string;
    startDate?: string;
  }) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);

    const obligation = await this.prisma.obligationTemplate.findFirst({
      where: { id: body.obligationTemplateId, tenantId },
    });
    if (!obligation) throw new BadRequestException('obligation template not in this tenant');
    if (body.scope === 'unit_scoped' && !body.unitId) {
      throw new BadRequestException('unit_scoped requires unitId');
    }
    if (body.executionMode === 'contracted' && !body.performerOrgId) {
      throw new BadRequestException('contracted mode requires performerOrgId');
    }
    if (body.executionMode === 'contracted' && !body.contractId) {
      // relaxed: allow creating without contract id, but warn in return
    }

    const template = await this.prisma.ppmTemplate.create({
      data: {
        tenantId, buildingId,
        name: body.name || obligation.name,
        description: body.description || null,
        domain: body.domain || obligation.domain || null,
        scope: body.scope || 'building_common',
        executionMode: body.executionMode,
        performerOrgId: body.performerOrgId || null,
        contractId: body.contractId || null,
        requiresApprovalBeforeOrder: body.executionMode === 'ad_hoc_approved',
        frequencyMonths: body.frequencyMonths ?? null,
        evidenceDocTypeKey: body.evidenceDocTypeKey || obligation.requiredDocumentTypeKey || null,
        assignedRole: body.assignedRole || null,
        createdBy: `user:${actorUserId}`,
      },
    });

    const recurrenceRule = body.recurrenceRule || obligation.recurrenceRule;
    const months = rruleMonths(recurrenceRule, body.frequencyMonths ?? null);
    const firstDue = body.startDate
      ? new Date(body.startDate)
      : addMonths(new Date(), Math.max(1, months));

    const planItem = await this.prisma.ppmPlanItem.create({
      data: {
        tenantId, buildingId,
        templateId: template.id,
        obligationTemplateId: obligation.id,
        assignedRole: body.assignedRole || 'maintenance_coordinator',
        recurrenceRule,
        nextDueAt: firstDue,
        unitId: body.unitId || null,
        scope: body.scope || 'building_common',
        executionMode: body.executionMode,
        performerOrgId: body.performerOrgId || null,
        contractId: body.contractId || null,
        createdBy: `user:${actorUserId}`,
      },
    });

    return { template, planItem };
  }

  async scheduleExecution(tenantId: string, actorUserId: string, planItemId: string, targetDate?: string) {
    await this.requireManager(tenantId, actorUserId);
    const plan = await this.prisma.ppmPlanItem.findFirst({
      where: { id: planItemId, tenantId },
      include: { obligation: true, template: true },
    });
    if (!plan) throw new NotFoundException('plan item not found');

    const due = targetDate ? new Date(targetDate) : plan.nextDueAt;
    const task = await this.prisma.taskInstance.create({
      data: {
        tenantId, buildingId: plan.buildingId,
        planItemId: plan.id, unitId: plan.unitId || null,
        title: plan.template.name,
        status: 'open',
        lifecycleStage: 'scheduled',
        executionMode: plan.executionMode,
        performerOrgId: plan.performerOrgId || null,
        dueAt: due,
        recurrenceRule: plan.recurrenceRule,
        evidenceRequired: !!plan.template.evidenceDocTypeKey,
        requiredDocumentTypeKey: plan.template.evidenceDocTypeKey || null,
        createdBy: `user:${actorUserId}`,
      },
    });
    await this.log(tenantId, plan.buildingId, task.id, actorUserId, 'scheduled', { planItemId });
    return task;
  }

  private async log(tenantId: string, buildingId: string, taskId: string, actor: string, eventType: string, metadata: any = {}) {
    await this.prisma.ppmExecutionLog.create({
      data: { tenantId, buildingId, taskId, actor, eventType, metadata },
    });
  }

  private async getTask(tenantId: string, taskId: string) {
    const t = await this.prisma.taskInstance.findFirst({
      where: { id: taskId, tenantId },
      include: { planItem: { include: { template: true } } },
    });
    if (!t) throw new NotFoundException('execution not found');
    return t;
  }

  /**
   * Separation of duties guard for a given lifecycle step.
   *
   *  - quoteRequester must not be the same person who later submits for approval
   *    (requester ≠ submitter) — unless there is no other maintenance_coordinator
   *  - submitter must not also be the approver (enforced by ApprovalRequest SoD)
   *  - executor (completion recorder) must not be the same as the final reviewer
   *    (closedByRoles enforced on completion review)
   *
   * Each guard emits a ForbiddenException with a clear reason so a UI can
   * explain why the action was blocked.
   */
  private assertSod(
    step:
      | 'submit_for_approval'
      | 'record_completion'
      | 'review_completion',
    actorUserId: string,
    context: {
      createdByUserId?: string | null;
      requesterUserId?: string | null;
      executorUserId?: string | null;
    },
  ) {
    if (step === 'submit_for_approval') {
      if (context.requesterUserId && context.requesterUserId === actorUserId) {
        throw new ForbiddenException('separation_of_duties: quote requester cannot submit the same quote for approval');
      }
    }
    if (step === 'review_completion') {
      if (context.executorUserId && context.executorUserId === actorUserId) {
        throw new ForbiddenException('separation_of_duties: executor cannot review their own completion');
      }
    }
  }

  private async transition(tenantId: string, actorUserId: string, taskId: string, from: string[], to: string, patch: any = {}) {
    await this.requireManager(tenantId, actorUserId);
    const task = await this.getTask(tenantId, taskId);
    if (from.length && !from.includes(task.lifecycleStage)) {
      throw new BadRequestException(`illegal transition from ${task.lifecycleStage} to ${to}`);
    }
    const updated = await this.prisma.taskInstance.update({
      where: { id: task.id },
      data: { lifecycleStage: to, ...patch },
    });
    await this.log(tenantId, task.buildingId, task.id, actorUserId, `lifecycle.${to}`, { from: task.lifecycleStage, patch });
    return updated;
  }

  async requestQuote(tenantId: string, actorUserId: string, taskId: string, body: { quoteDocumentId?: string; quoteAmount?: number; quoteCurrency?: string; notes?: string }) {
    const task = await this.getTask(tenantId, taskId);
    if (task.executionMode !== 'ad_hoc_approved') throw new BadRequestException('only ad_hoc_approved tasks use quote flow');
    return this.transition(tenantId, actorUserId, taskId, ['scheduled'], 'quote_requested', {
      quoteDocumentId: body.quoteDocumentId || null,
    });
  }

  async recordQuote(tenantId: string, actorUserId: string, taskId: string, body: { quoteDocumentId?: string; quoteAmount: number; quoteCurrency?: string }) {
    return this.transition(tenantId, actorUserId, taskId, ['quote_requested', 'scheduled'], 'quote_received', {
      quoteDocumentId: body.quoteDocumentId || null,
      quoteAmount: body.quoteAmount,
      quoteCurrency: body.quoteCurrency || 'ILS',
      quoteReceivedAt: new Date(),
    });
  }

  async submitForApproval(tenantId: string, actorUserId: string, taskId: string) {
    await this.requireManager(tenantId, actorUserId);
    const task = await this.getTask(tenantId, taskId);
    if (task.executionMode !== 'ad_hoc_approved') throw new BadRequestException('only ad_hoc_approved tasks need approval');
    if (task.lifecycleStage !== 'quote_received') throw new BadRequestException(`need quote_received, got ${task.lifecycleStage}`);

    // SoD: the person who requested / recorded the quote may not also submit it for approval.
    const quoteActorLog = await this.prisma.ppmExecutionLog.findFirst({
      where: { taskId: task.id, eventType: { in: ['lifecycle.quote_requested', 'lifecycle.quote_received'] } },
      orderBy: { createdAt: 'asc' },
    });
    this.assertSod('submit_for_approval', actorUserId, { requesterUserId: quoteActorLog?.actor });

    const approval = await this.prisma.approvalRequest.create({
      data: {
        tenantId, buildingId: task.buildingId,
        title: `PPM spend approval: ${task.title}`,
        type: 'spend_approval',
        amount: task.quoteAmount ?? 0,
        status: 'pending',
        requesterUserId: actorUserId,
        requesterName: actorUserId,
        hint: 'Ad-hoc PPM execution quote approval',
        steps: {
          create: [
            { orderNo: 1, role: 'building_manager', status: 'pending' },
            { orderNo: 2, role: 'owner_representative', status: 'pending' },
          ],
        },
      },
    });

    const updated = await this.prisma.taskInstance.update({
      where: { id: task.id },
      data: { lifecycleStage: 'awaiting_approval', approvalRequestId: approval.id },
    });
    await this.log(tenantId, task.buildingId, task.id, actorUserId, 'lifecycle.awaiting_approval', { approvalId: approval.id });
    return { task: updated, approvalRequestId: approval.id };
  }

  async markApproved(tenantId: string, actorUserId: string, taskId: string) {
    const task = await this.getTask(tenantId, taskId);
    if (task.executionMode !== 'ad_hoc_approved') throw new BadRequestException('not ad-hoc');
    if (!task.approvalRequestId) throw new BadRequestException('no approval attached');
    const ar = await this.prisma.approvalRequest.findUnique({ where: { id: task.approvalRequestId } });
    if (!ar || ar.status !== 'approved') throw new BadRequestException('approval not yet approved');
    // SoD: the approval requester cannot be the one marking it approved on the task (that came from a different actor via /approvals/:id/approve).
    if (ar.requesterUserId && ar.requesterUserId === actorUserId) {
      throw new ForbiddenException('separation_of_duties: approval requester cannot ratify their own approval');
    }
    return this.transition(tenantId, actorUserId, taskId, ['awaiting_approval'], 'approved', {
      approvedAt: new Date(),
    });
  }

  async placeOrder(tenantId: string, actorUserId: string, taskId: string) {
    const task = await this.getTask(tenantId, taskId);
    const allowedFrom = task.executionMode === 'ad_hoc_approved' ? ['approved'] : ['scheduled'];
    return this.transition(tenantId, actorUserId, taskId, allowedFrom, 'ordered', {
      orderedAt: new Date(),
    });
  }

  async markInProgress(tenantId: string, actorUserId: string, taskId: string) {
    const task = await this.getTask(tenantId, taskId);
    const allowed = task.executionMode === 'ad_hoc_approved' ? ['ordered'] : ['scheduled', 'ordered'];
    return this.transition(tenantId, actorUserId, taskId, allowed, 'in_progress', {});
  }

  async recordCompletion(tenantId: string, actorUserId: string, taskId: string, body: { serviceReportDocumentId?: string; evidenceDocuments?: string[]; result?: string; completedAt?: string; notes?: string }) {
    await this.requireManager(tenantId, actorUserId);
    const task = await this.getTask(tenantId, taskId);
    if (!['in_progress', 'ordered', 'scheduled'].includes(task.lifecycleStage)) {
      throw new BadRequestException(`cannot complete from ${task.lifecycleStage}`);
    }
    if (task.evidenceRequired && !body.serviceReportDocumentId && !(body.evidenceDocuments && body.evidenceDocuments.length)) {
      throw new BadRequestException('evidence required for completion');
    }
    const completedAt = body.completedAt ? new Date(body.completedAt) : new Date();

    const updated = await this.prisma.taskInstance.update({
      where: { id: task.id },
      data: {
        lifecycleStage: 'completed',
        status: 'completed',
        completedAt,
        completedByUserId: actorUserId,
        result: body.result || 'passed',
        serviceReportDocumentId: body.serviceReportDocumentId || null,
        evidenceDocuments: body.evidenceDocuments || undefined,
      },
    });

    if (task.planItemId) {
      const plan = await this.prisma.ppmPlanItem.findUnique({ where: { id: task.planItemId }, include: { template: true } });
      if (plan) {
        let nextDue = nextDueFrom(plan.recurrenceRule, completedAt, plan.template.frequencyMonths ?? null);
        const blackouts = await this.loadBlackouts(tenantId, plan.buildingId);
        if (blackouts.length > 0) {
          const shifted = applyBlackouts(nextDue, blackouts, plan.buildingId);
          if (shifted) nextDue = shifted;
        }
        await this.prisma.ppmPlanItem.update({
          where: { id: plan.id },
          data: { lastPerformedAt: completedAt, nextDueAt: nextDue },
        });
      }
    }

    await this.log(tenantId, task.buildingId, task.id, actorUserId, 'lifecycle.completed', {
      completedAt, serviceReportDocumentId: body.serviceReportDocumentId,
    });
    return updated;
  }

  /**
   * Review the completion. Enforces SoD: the executor (completedByUserId)
   * cannot also be the reviewer. The reviewer must either be workspace manager
   * or hold a closing role (default: chief_engineer / building_manager, or
   * whatever the template declared as closedByRoles).
   */
  async reviewCompletion(
    tenantId: string,
    actorUserId: string,
    taskId: string,
    body: { decision: 'accept' | 'reject'; note?: string },
  ) {
    const task = await this.getTask(tenantId, taskId);
    if (task.lifecycleStage !== 'completed') throw new BadRequestException(`cannot review from ${task.lifecycleStage}`);
    if (!['accept', 'reject'].includes(body.decision)) throw new BadRequestException('decision must be accept|reject');

    // SoD: executor ≠ reviewer.
    this.assertSod('review_completion', actorUserId, { executorUserId: task.completedByUserId });

    // Must hold a closing role if the template specifies one.
    const closingRoles = task.planItem?.template?.closedByRoles?.length
      ? task.planItem.template.closedByRoles
      : ['chief_engineer', 'building_manager'];
    const hasClosingRole = await this.prisma.buildingRoleAssignment.findFirst({
      where: { tenantId, buildingId: task.buildingId, userId: actorUserId, roleKey: { in: closingRoles } },
    });
    const isWsManager = await this.prisma.membership.findFirst({
      where: { tenantId, userId: actorUserId, roleKey: { in: ['workspace_owner', 'workspace_admin'] } },
    });
    if (!hasClosingRole && !isWsManager) {
      throw new ForbiddenException(`only one of [${closingRoles.join(', ')}] or workspace manager can review completion`);
    }

    if (body.decision === 'reject') {
      // Bounce back to in_progress so the executor can fix and re-submit.
      const updated = await this.prisma.taskInstance.update({
        where: { id: task.id },
        data: { lifecycleStage: 'in_progress', status: 'open', completedAt: null, completedByUserId: null, result: null },
      });
      await this.log(tenantId, task.buildingId, task.id, actorUserId, 'lifecycle.review.rejected', { note: body.note || null });
      return updated;
    }

    await this.log(tenantId, task.buildingId, task.id, actorUserId, 'lifecycle.review.accepted', { note: body.note || null });
    return task;
  }

  async distributeEvidence(tenantId: string, actorUserId: string, taskId: string, body: { recipients: Array<{ role?: string; userId?: string; email?: string; deliveredAt?: string }>; note?: string }) {
    const task = await this.getTask(tenantId, taskId);
    if (!['completed', 'evidence_distributed'].includes(task.lifecycleStage)) {
      throw new BadRequestException(`distribute only after completion (got ${task.lifecycleStage})`);
    }
    const prev = Array.isArray(task.evidenceDistributedTo) ? (task.evidenceDistributedTo as any[]) : [];
    const now = new Date().toISOString();
    const merged = [...prev, ...body.recipients.map((r) => ({ ...r, loggedAt: r.deliveredAt || now }))];
    return this.transition(tenantId, actorUserId, taskId, ['completed', 'evidence_distributed'], 'evidence_distributed', {
      evidenceDistributedTo: merged,
    });
  }

  async archive(tenantId: string, actorUserId: string, taskId: string) {
    return this.transition(tenantId, actorUserId, taskId, ['completed', 'evidence_distributed'], 'archived', {
      archivedAt: new Date(),
    });
  }

  async cancel(tenantId: string, actorUserId: string, taskId: string, reason?: string) {
    return this.transition(tenantId, actorUserId, taskId, ALL_STAGES.filter((s) => !['completed', 'archived', 'cancelled'].includes(s)), 'cancelled', {
      status: 'cancelled', blockedReason: reason || null,
    });
  }

  async listExecutions(tenantId: string, buildingIdOrSlug: string, filter: { stage?: string; scope?: string; limit?: number } = {}) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const where: any = { tenantId, buildingId };
    if (filter.stage) where.lifecycleStage = filter.stage;
    const tasks = await this.prisma.taskInstance.findMany({
      where, orderBy: { dueAt: 'asc' }, take: filter.limit || 200,
      include: { planItem: { include: { template: { select: { name: true, scope: true, executionMode: true, performerOrgId: true } } } } },
    });
    if (filter.scope) {
      return tasks.filter((t) => t.planItem?.template.scope === filter.scope);
    }
    return tasks;
  }

  async calendar(tenantId: string, buildingIdOrSlug: string, windowDays = 90) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const to = new Date(Date.now() + windowDays * 86400000);
    const items = await this.prisma.ppmPlanItem.findMany({
      where: { tenantId, buildingId, nextDueAt: { lte: to } },
      include: { template: true, obligation: { select: { name: true } } },
      orderBy: { nextDueAt: 'asc' },
    });
    return items.map((p) => ({
      planItemId: p.id,
      name: p.template.name,
      scope: p.scope,
      executionMode: p.executionMode,
      nextDueAt: p.nextDueAt,
      lastPerformedAt: p.lastPerformedAt,
      frequencyMonths: p.template.frequencyMonths,
    }));
  }

  async wizardCatalog(tenantId: string, buildingIdOrSlug: string) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);

    const [obligations, applied, marks, orgs, staff, roles] = await Promise.all([
      this.prisma.obligationTemplate.findMany({
        where: { tenantId },
        include: { bases: true, applicabilityRules: true },
        orderBy: [{ domain: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.ppmPlanItem.findMany({
        where: { tenantId, buildingId },
        include: {
          template: true,
        },
      }),
      this.prisma.buildingObligation.findMany({
        where: { tenantId, buildingId },
      }),
      this.prisma.organization.findMany({
        where: { tenantId },
        select: { id: true, name: true, type: true, slug: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.buildingRoleAssignment.findMany({
        where: { tenantId, buildingId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        include: {
          user: { select: { id: true, displayName: true, email: true, username: true } },
          role: { select: { key: true, name: true } },
        },
        orderBy: { delegatedAt: 'asc' },
      }),
      this.prisma.role.findMany({ select: { key: true, name: true, scope: true }, orderBy: { name: 'asc' } }),
    ]);

    const appliedByObligation = new Map<string, typeof applied[number]>();
    for (const p of applied) appliedByObligation.set(p.obligationTemplateId, p);

    const markByObligation = new Map<string, typeof marks[number]>();
    for (const m of marks) markByObligation.set(m.obligationTemplateId, m);

    const rows = obligations.map((o) => {
      const app = appliedByObligation.get(o.id);
      const mark = markByObligation.get(o.id);
      const status = app
        ? 'applied'
        : mark?.complianceStatus === 'not_applicable'
          ? 'not_applicable'
          : 'pending';
      const tpl = app?.template;
      return {
        obligationTemplateId: o.id,
        name: o.name,
        domain: o.domain,
        basisType: o.basisType,
        recurrenceRule: o.recurrenceRule,
        requiredCertificationKey: o.requiredCertificationKey,
        requiredDocumentTypeKey: o.requiredDocumentTypeKey,
        bases: o.bases.map((b) => ({ type: b.type, referenceCode: b.referenceCode })),
        applicability: o.applicabilityRules.map((r) => r.predicate as any),
        status,
        appliedProgram: tpl && app ? {
          planItemId: app.id,
          templateId: app.templateId,
          scope: tpl.scope,
          executionMode: tpl.executionMode,
          performerOrgId: tpl.performerOrgId,
          contractId: tpl.contractId,
          frequencyMonths: tpl.frequencyMonths,
          assignedRole: tpl.assignedRole,
          assignedUserId: tpl.assignedUserId,
          approvalChain: tpl.approvalChain,
          evidenceRecipients: tpl.evidenceRecipients,
          openedByRoles: tpl.openedByRoles,
          closedByRoles: tpl.closedByRoles,
          slaReminderDays: tpl.slaReminderDays,
          estimatedAnnualCost: tpl.estimatedAnnualCost,
          estimatedCostCurrency: tpl.estimatedCostCurrency,
          requiresPhotoEvidence: tpl.requiresPhotoEvidence,
          requiresSignoff: tpl.requiresSignoff,
          retentionYears: tpl.retentionYears,
          instructions: tpl.instructions,
          description: tpl.description,
          lastPerformedAt: app.lastPerformedAt,
          nextDueAt: app.nextDueAt,
        } : null,
        notApplicableNote: mark?.complianceStatus === 'not_applicable' ? mark.createdBy : null,
      };
    });

    const byStatus = rows.reduce<Record<string, number>>((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
    const byDomain = rows.reduce<Record<string, number>>((a, r) => (a[r.domain || 'other'] = (a[r.domain || 'other'] || 0) + 1, a), {});

    const staffList = staff.map((a) => ({
      userId: a.user.id,
      displayName: a.user.displayName,
      username: a.user.username,
      email: a.user.email,
      roleKey: a.roleKey,
      roleName: a.role.name,
    }));

    return {
      total: rows.length,
      byStatus, byDomain,
      organizations: orgs,
      staff: staffList,
      roles,
      items: rows,
    };
  }

  async wizardApply(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      items: Array<{
        obligationTemplateId: string;
        action: 'apply' | 'not_applicable' | 'remove' | 'skip';
        scope?: 'building_common' | 'unit_scoped';
        executionMode?: 'in_house' | 'contracted' | 'ad_hoc_approved';
        performerOrgId?: string | null;
        contractId?: string | null;
        frequencyMonths?: number | null;
        assignedRole?: string | null;
        assignedUserId?: string | null;
        approvalChain?: Array<{ role?: string; userId?: string; label?: string }> | null;
        evidenceRecipients?: Array<{ role?: string; userId?: string; channel?: string }> | null;
        openedByRoles?: string[];
        closedByRoles?: string[];
        slaReminderDays?: number[];
        estimatedAnnualCost?: number | null;
        estimatedCostCurrency?: string | null;
        requiresPhotoEvidence?: boolean;
        requiresSignoff?: boolean;
        retentionYears?: number | null;
        instructions?: string | null;
        description?: string | null;
        unitId?: string | null;
        note?: string | null;
      }>;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    if (!body?.items?.length) throw new BadRequestException('items required');

    let applied = 0, marked = 0, removed = 0, skipped = 0;
    for (const it of body.items) {
      if (it.action === 'skip') { skipped++; continue; }

      const obligation = await this.prisma.obligationTemplate.findFirst({
        where: { id: it.obligationTemplateId, tenantId },
      });
      if (!obligation) { skipped++; continue; }

      if (it.action === 'not_applicable') {
        const existingPlan = await this.prisma.ppmPlanItem.findFirst({
          where: { tenantId, buildingId, obligationTemplateId: obligation.id },
        });
        if (existingPlan) {
          await this.prisma.ppmPlanItem.deleteMany({ where: { obligationTemplateId: obligation.id, buildingId } });
          await this.prisma.ppmTemplate.deleteMany({ where: { buildingId, id: existingPlan.templateId } });
        }
        await this.prisma.buildingObligation.upsert({
          where: {
            seedKey: `na:${buildingId}:${obligation.id}`,
          },
          create: {
            tenantId, buildingId,
            obligationTemplateId: obligation.id,
            complianceStatus: 'not_applicable',
            criticality: 'low',
            seedKey: `na:${buildingId}:${obligation.id}`,
            createdBy: it.note ? `user:${actorUserId}:${it.note}` : `user:${actorUserId}`,
          },
          update: {
            complianceStatus: 'not_applicable',
            createdBy: it.note ? `user:${actorUserId}:${it.note}` : `user:${actorUserId}`,
          },
        });
        marked++;
        continue;
      }

      if (it.action === 'remove') {
        const existingPlan = await this.prisma.ppmPlanItem.findFirst({
          where: { tenantId, buildingId, obligationTemplateId: obligation.id },
        });
        if (existingPlan) {
          await this.prisma.ppmPlanItem.delete({ where: { id: existingPlan.id } });
          await this.prisma.ppmTemplate.deleteMany({ where: { id: existingPlan.templateId, buildingId } });
        }
        await this.prisma.buildingObligation.deleteMany({
          where: { buildingId, obligationTemplateId: obligation.id, complianceStatus: 'not_applicable' },
        });
        removed++;
        continue;
      }

      // action === 'apply'
      const executionMode = it.executionMode || 'in_house';
      const months = rruleMonths(obligation.recurrenceRule, it.frequencyMonths ?? null);
      const businessFields = {
        description: it.description ?? undefined,
        instructions: it.instructions ?? undefined,
        scope: it.scope ?? undefined,
        executionMode: it.executionMode ?? undefined,
        performerOrgId: it.performerOrgId === null ? null : it.performerOrgId ?? undefined,
        contractId: it.contractId === null ? null : it.contractId ?? undefined,
        requiresApprovalBeforeOrder: it.executionMode ? it.executionMode === 'ad_hoc_approved' : undefined,
        frequencyMonths: it.frequencyMonths ?? undefined,
        assignedRole: it.assignedRole ?? undefined,
        assignedUserId: it.assignedUserId === null ? null : it.assignedUserId ?? undefined,
        approvalChain: it.approvalChain === null ? null : (it.approvalChain as any) ?? undefined,
        evidenceRecipients: it.evidenceRecipients === null ? null : (it.evidenceRecipients as any) ?? undefined,
        openedByRoles: it.openedByRoles ?? undefined,
        closedByRoles: it.closedByRoles ?? undefined,
        slaReminderDays: it.slaReminderDays ?? undefined,
        estimatedAnnualCost: it.estimatedAnnualCost === null ? null : it.estimatedAnnualCost ?? undefined,
        estimatedCostCurrency: it.estimatedCostCurrency === null ? null : it.estimatedCostCurrency ?? undefined,
        requiresPhotoEvidence: it.requiresPhotoEvidence ?? undefined,
        requiresSignoff: it.requiresSignoff ?? undefined,
        retentionYears: it.retentionYears === null ? null : it.retentionYears ?? undefined,
      };

      const existingPlan = await this.prisma.ppmPlanItem.findFirst({
        where: { tenantId, buildingId, obligationTemplateId: obligation.id },
      });
      if (existingPlan) {
        await this.prisma.ppmTemplate.update({
          where: { id: existingPlan.templateId },
          data: businessFields,
        });
        await this.prisma.ppmPlanItem.update({
          where: { id: existingPlan.id },
          data: {
            scope: it.scope ?? undefined,
            executionMode: it.executionMode ?? undefined,
            performerOrgId: it.performerOrgId === null ? null : it.performerOrgId ?? undefined,
            contractId: it.contractId === null ? null : it.contractId ?? undefined,
            assignedRole: it.assignedRole ?? undefined,
            assignedUserId: it.assignedUserId === null ? null : it.assignedUserId ?? undefined,
            unitId: it.unitId === null ? null : it.unitId ?? undefined,
          },
        });
        applied++;
      } else {
        const template = await this.prisma.ppmTemplate.create({
          data: {
            tenantId, buildingId,
            name: obligation.name,
            description: it.description || null,
            instructions: it.instructions || null,
            domain: obligation.domain,
            scope: it.scope || 'building_common',
            executionMode,
            performerOrgId: it.performerOrgId || null,
            contractId: it.contractId || null,
            requiresApprovalBeforeOrder: executionMode === 'ad_hoc_approved',
            frequencyMonths: it.frequencyMonths ?? months,
            evidenceDocTypeKey: obligation.requiredDocumentTypeKey,
            assignedRole: it.assignedRole || null,
            assignedUserId: it.assignedUserId || null,
            approvalChain: (it.approvalChain as any) || null,
            evidenceRecipients: (it.evidenceRecipients as any) || null,
            openedByRoles: it.openedByRoles || [],
            closedByRoles: it.closedByRoles || [],
            slaReminderDays: it.slaReminderDays || [30, 14, 3],
            estimatedAnnualCost: it.estimatedAnnualCost ?? null,
            estimatedCostCurrency: it.estimatedCostCurrency || 'ILS',
            requiresPhotoEvidence: it.requiresPhotoEvidence ?? false,
            requiresSignoff: it.requiresSignoff ?? false,
            retentionYears: it.retentionYears ?? null,
            createdBy: `user:${actorUserId}`,
          },
        });
        await this.prisma.ppmPlanItem.create({
          data: {
            tenantId, buildingId,
            templateId: template.id,
            obligationTemplateId: obligation.id,
            assignedRole: it.assignedRole || 'maintenance_coordinator',
            assignedUserId: it.assignedUserId || null,
            recurrenceRule: obligation.recurrenceRule,
            nextDueAt: addMonths(new Date(), Math.max(1, months)),
            unitId: it.unitId || null,
            scope: it.scope || 'building_common',
            executionMode,
            performerOrgId: it.performerOrgId || null,
            contractId: it.contractId || null,
            createdBy: `user:${actorUserId}`,
          },
        });
        await this.prisma.buildingObligation.deleteMany({
          where: { buildingId, obligationTemplateId: obligation.id, complianceStatus: 'not_applicable' },
        });
        applied++;
      }
    }

    return { applied, marked, removed, skipped };
  }

  async getExecution(tenantId: string, taskId: string) {
    const task = await this.getTask(tenantId, taskId);
    const logs = await this.prisma.ppmExecutionLog.findMany({
      where: { taskId: task.id }, orderBy: { createdAt: 'asc' },
    });
    let approval = null;
    if (task.approvalRequestId) {
      approval = await this.prisma.approvalRequest.findUnique({
        where: { id: task.approvalRequestId }, include: { steps: { orderBy: { orderNo: 'asc' } } },
      });
    }
    return { task, logs, approval };
  }
}
