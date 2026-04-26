import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { requireManager, resolveBuildingId } from '../../common/building.helpers';
import { approxMonths, nextAfter, addMonthsUtc } from './engine/recurrence';
import { applyBlackouts, BlackoutRule } from './engine/blackout';

// Recognise the DB-level partial unique indexes declared in
// 001_ppm_plan_item_unique.sql. Prisma sets meta.target on P2002 to the index
// name for raw-SQL indexes, so we match on that to produce a friendly error.
const PPM_PLAN_ITEM_UNIQUE_INDEXES = new Set([
  'ppm_plan_items_unique_scope_no_unit',
  'ppm_plan_items_unique_scope_unit',
]);

function isPpmPlanItemUniqueConflict(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  if (typeof target === 'string') return PPM_PLAN_ITEM_UNIQUE_INDEXES.has(target);
  if (Array.isArray(target)) return target.some((t) => PPM_PLAN_ITEM_UNIQUE_INDEXES.has(String(t)));
  return true; // unknown target shape — treat any P2002 on this table as dup
}

const DUPLICATE_PLAN_ITEM_MSG =
  'a PPM program already exists for this obligation + scope + unit in this building';

/**
 * Lifecycle stages for PPM executions (TaskInstance).
 *
 * - in_house:          scheduled → in_progress → completed → archived
 * - contracted:        scheduled → in_progress → completed → archived
 * - ad_hoc_approved:   scheduled → quote_requested → quote_received → awaiting_approval → approved → ordered
 *                      → in_progress → completed → evidence_distributed → archived
 */
const ALL_STAGES = [
  'scheduled',
  'quote_requested',
  'quote_received',
  'awaiting_approval',
  'approved',
  'ordered',
  'in_progress',
  'completed',
  'evidence_distributed',
  'archived',
  'cancelled',
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
  ) {}

  // INIT-010 Phase 1 / P0-1 — entry point for condition-triggers.
  //
  // condition-triggers used to call `prisma.taskInstance.create()` directly,
  // which violated SSOT (taskInstance is owned by ppm). The fix routes the
  // creation through this method so ownership stays with ppm. When the
  // outbox pattern lands (INIT-010 Phase 7), this call is replaced by a
  // subscriber that consumes a `condition.triggered` event — same semantics,
  // pub/sub instead of direct DI.
  async createTaskFromTrigger(input: {
    tenantId: string;
    buildingId: string;
    templateId: string | null;
    title: string;
    dueAt: Date;
  }) {
    const template = input.templateId
      ? await this.prisma.ppmTemplate.findUnique({ where: { id: input.templateId } })
      : null;
    return this.prisma.taskInstance.create({
      data: {
        tenantId: input.tenantId,
        buildingId: input.buildingId,
        title: input.title,
        status: 'open',
        lifecycleStage: 'scheduled',
        executionMode: template?.executionMode || 'in_house',
        dueAt: input.dueAt,
        evidenceRequired: !!template?.evidenceDocTypeKey,
      },
    });
  }

  private async loadBlackouts(tenantId: string, buildingId: string): Promise<BlackoutRule[]> {
    const rows = await this.prisma.calendarBlackout.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [{ buildingId: null }, { buildingId }],
      },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      dayOfWeek: r.dayOfWeek,
      startDate: r.startDate,
      endDate: r.endDate,
      annualRecurring: r.annualRecurring,
      policy: r.policy as any,
      isActive: r.isActive,
      buildingId: r.buildingId,
    }));
  }

  // PPM includes maintenance_coordinator as an authorised building role
  // (they schedule PPM executions even without manager rights).
  private requireManager = (tenantId: string, actorUserId: string) =>
    requireManager(this.prisma, tenantId, actorUserId, {
      extraBuildingRoles: ['maintenance_coordinator'],
    });
  private resolveBuildingId = (tenantId: string, idOrSlug: string) =>
    resolveBuildingId(this.prisma, tenantId, idOrSlug);

  async listPrograms(
    tenantId: string,
    buildingIdOrSlug: string,
    opts: { includeAwaitingOnboarding?: boolean } = {},
  ) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    // By default templates whose plan items are ALL still awaiting baseline
    // onboarding are hidden from the main Programs surface — they live on the
    // Setup page. Pass includeAwaitingOnboarding=true to see them all.
    const templateWhere = opts.includeAwaitingOnboarding
      ? { tenantId, buildingId }
      : { tenantId, buildingId, planItems: { some: { baselineStatus: { not: 'pending' } } } };
    const items = await this.prisma.ppmTemplate.findMany({
      where: templateWhere,
      include: {
        planItems: {
          ...(opts.includeAwaitingOnboarding
            ? {}
            : { where: { baselineStatus: { not: 'pending' } } }),
          include: {
            obligation: { select: { name: true, domain: true, requiredDocumentTypeKey: true } },
          },
        },
      },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
    });
    const orgIds = [...new Set(items.map((x) => x.performerOrgId).filter((x): x is string => !!x))];
    const orgs = orgIds.length
      ? await this.prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true, type: true },
        })
      : [];
    const orgById = new Map(orgs.map((o) => [o.id, o]));
    return items.map((t) => {
      const nextDue =
        t.planItems.map((p) => p.nextDueAt).sort((a, b) => a.getTime() - b.getTime())[0] || null;
      const lastDone =
        t.planItems
          .map((p) => p.lastPerformedAt)
          .filter((x): x is Date => !!x)
          .sort((a, b) => b.getTime() - a.getTime())[0] || null;
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        domain: t.domain,
        scope: t.scope,
        executionMode: t.executionMode,
        performerOrg: t.performerOrgId ? orgById.get(t.performerOrgId) : null,
        contractId: t.contractId,
        requiresApprovalBeforeOrder: t.requiresApprovalBeforeOrder,
        frequencyMonths: t.frequencyMonths,
        evidenceDocTypeKey: t.evidenceDocTypeKey,
        evidenceDocumentTemplateId: (t as any).evidenceDocumentTemplateId ?? null,
        assignedRole: t.assignedRole,
        planItemsCount: t.planItems.length,
        nextDueAt: nextDue,
        lastPerformedAt: lastDone,
      };
    });
  }

  async createProgram(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
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
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);

    const obligation = await this.prisma.obligationTemplate.findFirst({
      where: { id: body.obligationTemplateId, tenantId },
    });
    if (!obligation) throw new BadRequestException('obligation template not in this tenant');
    if (body.scope === 'unit_scoped' && !body.unitId) {
      throw new BadRequestException('unit_scoped requires unitId');
    }
    // Guard against duplicate program creation: one plan item per building +
    // obligation + (unit for unit_scoped). DB-level partial uniqueness is not
    // expressible here due to nullable unitId so we enforce it in-app.
    const duplicate = await this.prisma.ppmPlanItem.findFirst({
      where: {
        tenantId,
        buildingId,
        obligationTemplateId: obligation.id,
        scope: body.scope || 'building_common',
        unitId: body.unitId || null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(
        'a PPM program already exists for this obligation + scope + unit in this building',
      );
    }
    if (body.executionMode === 'contracted' && !body.performerOrgId) {
      throw new BadRequestException('contracted mode requires performerOrgId');
    }
    if (body.executionMode === 'contracted' && !body.contractId) {
      // relaxed: allow creating without contract id, but warn in return
    }

    const template = await this.prisma.ppmTemplate.create({
      data: {
        tenantId,
        buildingId,
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

    let planItem;
    try {
      planItem = await this.prisma.ppmPlanItem.create({
        data: {
          tenantId,
          buildingId,
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
    } catch (e) {
      // DB-level race guard: a sibling call created the same plan item between
      // the app-level pre-check and this insert. Roll back the orphan template
      // and surface a clean business error.
      if (isPpmPlanItemUniqueConflict(e)) {
        await this.prisma.ppmTemplate.delete({ where: { id: template.id } }).catch(() => undefined);
        throw new ConflictException(DUPLICATE_PLAN_ITEM_MSG);
      }
      throw e;
    }

    return { template, planItem };
  }

  async scheduleExecution(
    tenantId: string,
    actorUserId: string,
    planItemId: string,
    targetDate?: string,
  ) {
    await this.requireManager(tenantId, actorUserId);
    const plan = await this.prisma.ppmPlanItem.findFirst({
      where: { id: planItemId, tenantId },
      include: { obligation: true, template: true },
    });
    if (!plan) throw new NotFoundException('plan item not found');

    const due = targetDate ? new Date(targetDate) : plan.nextDueAt;
    const task = await this.prisma.taskInstance.create({
      data: {
        tenantId,
        buildingId: plan.buildingId,
        planItemId: plan.id,
        unitId: plan.unitId || null,
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

  private async log(
    tenantId: string,
    buildingId: string,
    taskId: string,
    actor: string,
    eventType: string,
    metadata: any = {},
  ) {
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
    step: 'submit_for_approval' | 'record_completion' | 'review_completion',
    actorUserId: string,
    context: {
      createdByUserId?: string | null;
      requesterUserId?: string | null;
      executorUserId?: string | null;
    },
  ) {
    if (step === 'submit_for_approval') {
      if (context.requesterUserId && context.requesterUserId === actorUserId) {
        throw new ForbiddenException(
          'separation_of_duties: quote requester cannot submit the same quote for approval',
        );
      }
    }
    if (step === 'review_completion') {
      if (context.executorUserId && context.executorUserId === actorUserId) {
        throw new ForbiddenException(
          'separation_of_duties: executor cannot review their own completion',
        );
      }
    }
  }

  private async transition(
    tenantId: string,
    actorUserId: string,
    taskId: string,
    from: string[],
    to: string,
    patch: any = {},
  ) {
    await this.requireManager(tenantId, actorUserId);
    const task = await this.getTask(tenantId, taskId);
    if (from.length && !from.includes(task.lifecycleStage)) {
      throw new BadRequestException(`illegal transition from ${task.lifecycleStage} to ${to}`);
    }
    const updated = await this.prisma.taskInstance.update({
      where: { id: task.id },
      data: { lifecycleStage: to, ...patch },
    });
    await this.log(tenantId, task.buildingId, task.id, actorUserId, `lifecycle.${to}`, {
      from: task.lifecycleStage,
      patch,
    });
    return updated;
  }

  async requestQuote(
    tenantId: string,
    actorUserId: string,
    taskId: string,
    body: {
      quoteDocumentId?: string;
      quoteAmount?: number;
      quoteCurrency?: string;
      notes?: string;
    },
  ) {
    const task = await this.getTask(tenantId, taskId);
    if (task.executionMode !== 'ad_hoc_approved')
      throw new BadRequestException('only ad_hoc_approved tasks use quote flow');
    return this.transition(tenantId, actorUserId, taskId, ['scheduled'], 'quote_requested', {
      quoteDocumentId: body.quoteDocumentId || null,
    });
  }

  async recordQuote(
    tenantId: string,
    actorUserId: string,
    taskId: string,
    body: { quoteDocumentId?: string; quoteAmount: number; quoteCurrency?: string },
  ) {
    return this.transition(
      tenantId,
      actorUserId,
      taskId,
      ['quote_requested', 'scheduled'],
      'quote_received',
      {
        quoteDocumentId: body.quoteDocumentId || null,
        quoteAmount: body.quoteAmount,
        quoteCurrency: body.quoteCurrency || 'ILS',
        quoteReceivedAt: new Date(),
      },
    );
  }

  async submitForApproval(tenantId: string, actorUserId: string, taskId: string) {
    await this.requireManager(tenantId, actorUserId);
    const task = await this.getTask(tenantId, taskId);
    if (task.executionMode !== 'ad_hoc_approved')
      throw new BadRequestException('only ad_hoc_approved tasks need approval');
    if (task.lifecycleStage !== 'quote_received')
      throw new BadRequestException(`need quote_received, got ${task.lifecycleStage}`);

    // SoD: the person who requested / recorded the quote may not also submit it for approval.
    const quoteActorLog = await this.prisma.ppmExecutionLog.findFirst({
      where: {
        taskId: task.id,
        eventType: { in: ['lifecycle.quote_requested', 'lifecycle.quote_received'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    this.assertSod('submit_for_approval', actorUserId, { requesterUserId: quoteActorLog?.actor });

    const approval = await this.approvals.createRequest({
      tenantId,
      buildingId: task.buildingId,
      title: `PPM spend approval: ${task.title}`,
      type: 'spend_approval',
      amount: task.quoteAmount ?? 0,
      requesterUserId: actorUserId,
      hint: 'Ad-hoc PPM execution quote approval',
      steps: [
        { orderNo: 1, role: 'building_manager' },
        { orderNo: 2, role: 'owner_representative' },
      ],
    });

    const updated = await this.prisma.taskInstance.update({
      where: { id: task.id },
      data: { lifecycleStage: 'awaiting_approval', approvalRequestId: approval.id },
    });
    await this.log(tenantId, task.buildingId, task.id, actorUserId, 'lifecycle.awaiting_approval', {
      approvalId: approval.id,
    });
    return { task: updated, approvalRequestId: approval.id };
  }

  async markApproved(tenantId: string, actorUserId: string, taskId: string) {
    const task = await this.getTask(tenantId, taskId);
    if (task.executionMode !== 'ad_hoc_approved') throw new BadRequestException('not ad-hoc');
    if (!task.approvalRequestId) throw new BadRequestException('no approval attached');
    const ar = await this.prisma.approvalRequest.findUnique({
      where: { id: task.approvalRequestId },
    });
    if (!ar || ar.status !== 'approved') throw new BadRequestException('approval not yet approved');
    // SoD: the approval requester cannot be the one marking it approved on the task (that came from a different actor via /approvals/:id/approve).
    if (ar.requesterUserId && ar.requesterUserId === actorUserId) {
      throw new ForbiddenException(
        'separation_of_duties: approval requester cannot ratify their own approval',
      );
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

  /**
   * List PPM plan items for a building — lean payload used by the PPM Setup
   * (baseline) page and other dashboards. Filter by baselineStatus to
   * restrict to onboarding-pending rows or the main-flow rows only.
   */
  async listPlanItems(
    tenantId: string,
    buildingIdOrSlug: string,
    filter: { baselineStatus?: string } = {},
  ) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const where: any = { tenantId, buildingId };
    if (filter.baselineStatus) where.baselineStatus = filter.baselineStatus;
    return this.prisma.ppmPlanItem.findMany({
      where,
      select: {
        id: true,
        templateId: true,
        nextDueAt: true,
        lastPerformedAt: true,
        scope: true,
        executionMode: true,
        assignedRole: true,
        baselineStatus: true,
        baselineSetAt: true,
        baselineNote: true,
        baselineEvidenceDocumentId: true,
      },
    });
  }

  /**
   * Takeover baseline — record that a PPM program was last performed on a
   * date BEFORE Domera started tracking it. Used when a building is handed
   * over from another operator and you need to:
   *   1. Set `lastPerformedAt` on the plan item (occurred_at, from the old
   *      operator's records).
   *   2. Recompute `nextDueAt` from RRULE + blackouts so the scheduler
   *      doesn't falsely open an overdue task.
   *   3. Create a CompletionRecord (source=baseline) with the dual-timestamp
   *      split: `completedAt = occurred_at` (historic), `createdAt =
   *      recorded_at` (now). This preserves the audit chain: "we took over
   *      on X, the previous operator had last performed this on Y".
   *   4. Optionally attach an evidence Document (scanned handover pack).
   */
  /**
   * Resolve a plan item's baseline in one of three modes:
   *   - mode='set': operator knows the last-performed date + has evidence.
   *       Recomputes nextDueAt from RRULE + blackouts. Writes a
   *       CompletionRecord (dual-timestamps).
   *   - mode='unknown_immediate': operator has no record; plan item enters
   *       the main flow immediately overdue (nextDueAt=now).
   *   - mode='unknown_backdated': operator has no record; plan item enters
   *       the main flow awaiting a back-dated completion (nextDueAt=now,
   *       baselineNote carries the intent so the UI can show a "close
   *       back-dated" prompt when operator finds the paperwork).
   *
   * In every mode, baselineStatus flips away from 'pending' so the
   * scheduler / compliance dashboards start including the row.
   */
  async recordBaseline(
    tenantId: string,
    actorUserId: string,
    planItemId: string,
    body: {
      mode?: 'set' | 'unknown_immediate' | 'unknown_backdated';
      lastPerformedAt?: string;
      evidenceDocumentId?: string | null;
      notes?: string | null;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);

    const plan = await this.prisma.ppmPlanItem.findFirst({
      where: { id: planItemId, tenantId },
      include: { template: true },
    });
    if (!plan) throw new NotFoundException('plan item not found');

    const mode = body.mode || (body.lastPerformedAt ? 'set' : null);
    if (!mode) throw new BadRequestException('mode or lastPerformedAt required');

    // ── mode=set: real historical date + optional evidence ────────
    if (mode === 'set') {
      if (!body.lastPerformedAt)
        throw new BadRequestException('lastPerformedAt required when mode=set');
      const occurredAt = new Date(body.lastPerformedAt);
      if (isNaN(occurredAt.getTime()))
        throw new BadRequestException('lastPerformedAt must be a valid date');
      if (occurredAt.getTime() > Date.now())
        throw new BadRequestException('lastPerformedAt cannot be in the future');

      if (body.evidenceDocumentId) {
        const doc = await this.prisma.document.findFirst({
          where: { id: body.evidenceDocumentId, tenantId, buildingId: plan.buildingId },
        });
        if (!doc) throw new NotFoundException('evidence document not found in this building');
      }

      let nextDue = nextDueFrom(
        plan.recurrenceRule,
        occurredAt,
        plan.template.frequencyMonths ?? null,
      );
      const blackouts = await this.loadBlackouts(tenantId, plan.buildingId);
      if (blackouts.length > 0) {
        const shifted = applyBlackouts(nextDue, blackouts, plan.buildingId);
        if (shifted) nextDue = shifted;
      }

      const updatedPlan = await this.prisma.ppmPlanItem.update({
        where: { id: plan.id },
        data: {
          lastPerformedAt: occurredAt,
          nextDueAt: nextDue,
          baselineStatus: 'set',
          baselineSetAt: new Date(),
          baselineSetByUserId: actorUserId,
          baselineEvidenceDocumentId: body.evidenceDocumentId || null,
          baselineNote: body.notes || null,
        },
      });

      const completion = await this.prisma.completionRecord.create({
        data: {
          tenantId,
          buildingId: plan.buildingId,
          taskInstanceId: null,
          workOrderId: null,
          completedByUserId: `baseline:${actorUserId}`,
          completedAt: occurredAt,
          serviceReportDocumentId: body.evidenceDocumentId || null,
          notes: [
            body.notes,
            'Baseline entry (set) — recorded at takeover from prior operator records.',
          ]
            .filter(Boolean)
            .join(' — '),
        },
      });

      // PpmExecutionLog.taskId FK requires a TaskInstance; at baseline time
      // no task exists yet, so the write will fail. Swallow — baseline
      // already writes a CompletionRecord + AuditEntry, and a plan-item-
      // scoped log table is TODO.
      await this.log(tenantId, plan.buildingId, plan.id, actorUserId, 'baseline.set', {
        occurredAt,
        nextDueAt: nextDue,
        evidenceDocumentId: body.evidenceDocumentId || null,
        completionRecordId: completion.id,
      }).catch(() => undefined);

      return {
        ok: true,
        mode: 'set' as const,
        planItemId: updatedPlan.id,
        lastPerformedAt: updatedPlan.lastPerformedAt,
        nextDueAt: updatedPlan.nextDueAt,
        baselineStatus: updatedPlan.baselineStatus,
        completionRecordId: completion.id,
      };
    }

    // ── mode=unknown_immediate / unknown_backdated ────────────────
    const now = new Date();
    const noteText =
      mode === 'unknown_immediate'
        ? 'Baseline unknown — plan item enters main flow flagged for immediate execution.'
        : 'Baseline unknown — plan item enters main flow awaiting back-dated completion with confirming document.';

    const updatedPlan = await this.prisma.ppmPlanItem.update({
      where: { id: plan.id },
      data: {
        lastPerformedAt: null,
        nextDueAt: now,
        baselineStatus: 'unknown',
        baselineSetAt: now,
        baselineSetByUserId: actorUserId,
        baselineEvidenceDocumentId: null,
        baselineNote: [body.notes, noteText].filter(Boolean).join(' — '),
      },
    });

    // Same reason as above — no TaskInstance exists yet at baseline time.
    await this.log(tenantId, plan.buildingId, plan.id, actorUserId, `baseline.${mode}`, {
      note: noteText,
      mode,
    }).catch(() => undefined);

    return {
      ok: true,
      mode,
      planItemId: updatedPlan.id,
      lastPerformedAt: null,
      nextDueAt: updatedPlan.nextDueAt,
      baselineStatus: updatedPlan.baselineStatus,
    };
  }

  /**
   * Bulk baseline entry — one call per building, setting last-performed dates
   * across many plan items at once. Skipped rows are ignored (no-op). Returns
   * counts and per-row results for the UI.
   */
  async recordBaselineBulk(
    tenantId: string,
    actorUserId: string,
    buildingIdOrSlug: string,
    body: {
      items: Array<{
        planItemId: string;
        mode?: 'set' | 'unknown_immediate' | 'unknown_backdated';
        lastPerformedAt?: string;
        evidenceDocumentId?: string | null;
        notes?: string | null;
        skip?: boolean;
      }>;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const results: Array<{
      planItemId: string;
      ok: boolean;
      error?: string;
      mode?: string;
      lastPerformedAt?: Date | null;
      nextDueAt?: Date;
      baselineStatus?: string;
    }> = [];
    let applied = 0,
      skipped = 0,
      errored = 0;

    for (const it of body.items || []) {
      // Explicit skip OR no actionable intent → leave the row in baseline
      // pending; it will NOT be moved into the main flow.
      if (it.skip || (!it.mode && !it.lastPerformedAt)) {
        skipped++;
        results.push({ planItemId: it.planItemId, ok: true });
        continue;
      }
      try {
        const plan = await this.prisma.ppmPlanItem.findFirst({
          where: { id: it.planItemId, tenantId, buildingId },
          select: { id: true },
        });
        if (!plan) throw new NotFoundException('plan item not in this building');
        const r = await this.recordBaseline(tenantId, actorUserId, it.planItemId, {
          mode: it.mode,
          lastPerformedAt: it.lastPerformedAt,
          evidenceDocumentId: it.evidenceDocumentId || null,
          notes: it.notes || null,
        });
        applied++;
        results.push({
          planItemId: it.planItemId,
          ok: true,
          mode: r.mode,
          lastPerformedAt: r.lastPerformedAt as any,
          nextDueAt: r.nextDueAt as any,
          baselineStatus: r.baselineStatus,
        });
      } catch (e: any) {
        errored++;
        results.push({ planItemId: it.planItemId, ok: false, error: e?.message || 'failed' });
      }
    }
    return { applied, skipped, errored, total: (body.items || []).length, results };
  }

  async markInProgress(tenantId: string, actorUserId: string, taskId: string) {
    const task = await this.getTask(tenantId, taskId);
    const allowed =
      task.executionMode === 'ad_hoc_approved' ? ['ordered'] : ['scheduled', 'ordered'];
    return this.transition(tenantId, actorUserId, taskId, allowed, 'in_progress', {});
  }

  async recordCompletion(
    tenantId: string,
    actorUserId: string,
    taskId: string,
    body: {
      serviceReportDocumentId?: string;
      evidenceDocuments?: string[];
      result?: string;
      completedAt?: string;
      notes?: string;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const task = await this.getTask(tenantId, taskId);
    if (!['in_progress', 'ordered', 'scheduled'].includes(task.lifecycleStage)) {
      throw new BadRequestException(`cannot complete from ${task.lifecycleStage}`);
    }
    if (
      task.evidenceRequired &&
      !body.serviceReportDocumentId &&
      !(body.evidenceDocuments && body.evidenceDocuments.length)
    ) {
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
      const plan = await this.prisma.ppmPlanItem.findUnique({
        where: { id: task.planItemId },
        include: { template: true },
      });
      if (plan) {
        let nextDue = nextDueFrom(
          plan.recurrenceRule,
          completedAt,
          plan.template.frequencyMonths ?? null,
        );
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
      completedAt,
      serviceReportDocumentId: body.serviceReportDocumentId,
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
    if (task.lifecycleStage !== 'completed')
      throw new BadRequestException(`cannot review from ${task.lifecycleStage}`);
    if (!['accept', 'reject'].includes(body.decision))
      throw new BadRequestException('decision must be accept|reject');

    // SoD: executor ≠ reviewer.
    this.assertSod('review_completion', actorUserId, { executorUserId: task.completedByUserId });

    // Must hold a closing role if the template specifies one.
    const closingRoles = task.planItem?.template?.closedByRoles?.length
      ? task.planItem.template.closedByRoles
      : ['chief_engineer', 'building_manager'];
    const hasClosingRole = await this.prisma.buildingRoleAssignment.findFirst({
      where: {
        tenantId,
        buildingId: task.buildingId,
        userId: actorUserId,
        roleKey: { in: closingRoles },
      },
    });
    const isWsManager = await this.prisma.membership.findFirst({
      where: {
        tenantId,
        userId: actorUserId,
        roleKey: { in: ['workspace_owner', 'workspace_admin'] },
      },
    });
    if (!hasClosingRole && !isWsManager) {
      throw new ForbiddenException(
        `only one of [${closingRoles.join(', ')}] or workspace manager can review completion`,
      );
    }

    if (body.decision === 'reject') {
      // Bounce back to in_progress so the executor can fix and re-submit.
      const updated = await this.prisma.taskInstance.update({
        where: { id: task.id },
        data: {
          lifecycleStage: 'in_progress',
          status: 'open',
          completedAt: null,
          completedByUserId: null,
          result: null,
        },
      });
      await this.log(tenantId, task.buildingId, task.id, actorUserId, 'lifecycle.review.rejected', {
        note: body.note || null,
      });
      return updated;
    }

    await this.log(tenantId, task.buildingId, task.id, actorUserId, 'lifecycle.review.accepted', {
      note: body.note || null,
    });
    return task;
  }

  async distributeEvidence(
    tenantId: string,
    actorUserId: string,
    taskId: string,
    body: {
      recipients: Array<{ role?: string; userId?: string; email?: string; deliveredAt?: string }>;
      note?: string;
    },
  ) {
    const task = await this.getTask(tenantId, taskId);
    if (!['completed', 'evidence_distributed'].includes(task.lifecycleStage)) {
      throw new BadRequestException(
        `distribute only after completion (got ${task.lifecycleStage})`,
      );
    }
    const prev = Array.isArray(task.evidenceDistributedTo)
      ? (task.evidenceDistributedTo as any[])
      : [];
    const now = new Date().toISOString();
    const merged = [
      ...prev,
      ...body.recipients.map((r) => ({ ...r, loggedAt: r.deliveredAt || now })),
    ];
    return this.transition(
      tenantId,
      actorUserId,
      taskId,
      ['completed', 'evidence_distributed'],
      'evidence_distributed',
      {
        evidenceDistributedTo: merged,
      },
    );
  }

  async archive(tenantId: string, actorUserId: string, taskId: string) {
    return this.transition(
      tenantId,
      actorUserId,
      taskId,
      ['completed', 'evidence_distributed'],
      'archived',
      {
        archivedAt: new Date(),
      },
    );
  }

  async cancel(tenantId: string, actorUserId: string, taskId: string, reason?: string) {
    return this.transition(
      tenantId,
      actorUserId,
      taskId,
      ALL_STAGES.filter((s) => !['completed', 'archived', 'cancelled'].includes(s)),
      'cancelled',
      {
        status: 'cancelled',
        blockedReason: reason || null,
      },
    );
  }

  async listExecutions(
    tenantId: string,
    buildingIdOrSlug: string,
    filter: { stage?: string; scope?: string; limit?: number } = {},
  ) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const where: any = { tenantId, buildingId };
    if (filter.stage) where.lifecycleStage = filter.stage;
    const tasks = await this.prisma.taskInstance.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      take: filter.limit || 200,
      include: {
        planItem: {
          include: {
            template: {
              select: { name: true, scope: true, executionMode: true, performerOrgId: true },
            },
          },
        },
      },
    });
    if (filter.scope) {
      return tasks.filter((t) => t.planItem?.template.scope === filter.scope);
    }
    return tasks;
  }

  async calendar(tenantId: string, buildingIdOrSlug: string, windowDays = 90) {
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    const to = new Date(Date.now() + windowDays * 86400000);
    // Exclude 'pending' (awaiting baseline) — those live on the Setup page only.
    const items = await this.prisma.ppmPlanItem.findMany({
      where: {
        tenantId,
        buildingId,
        nextDueAt: { lte: to },
        baselineStatus: { not: 'pending' },
      },
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
        where: {
          tenantId,
          buildingId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: {
          user: { select: { id: true, displayName: true, email: true, username: true } },
          role: { select: { key: true, name: true } },
        },
        orderBy: { delegatedAt: 'asc' },
      }),
      this.prisma.role.findMany({
        select: { key: true, name: true, scope: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Prefer a managed plan item per obligation when multiple exist (e.g. a
    // managed one + a lingering pending sibling created before baseline was set).
    const appliedByObligation = new Map<string, (typeof applied)[number]>();
    for (const p of applied) {
      const existing = appliedByObligation.get(p.obligationTemplateId);
      if (!existing) {
        appliedByObligation.set(p.obligationTemplateId, p);
        continue;
      }
      if (existing.baselineStatus === 'pending' && p.baselineStatus !== 'pending') {
        appliedByObligation.set(p.obligationTemplateId, p);
      }
    }

    const markByObligation = new Map<string, (typeof marks)[number]>();
    for (const m of marks) markByObligation.set(m.obligationTemplateId, m);

    const rows = obligations.map((o) => {
      const app = appliedByObligation.get(o.id);
      const mark = markByObligation.get(o.id);
      // "applied" in the wizard === managed PPM (plan item exists AND has its
      // baseline resolved). Plan items still in baselineStatus='pending' are
      // treated as awaiting setup — they show up on /ppm/setup, not here.
      const isManaged = !!app && app.baselineStatus !== 'pending';
      const status = isManaged
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
        appliedProgram:
          tpl && app
            ? {
                planItemId: app.id,
                templateId: app.templateId,
                baselineStatus: app.baselineStatus,
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
              }
            : null,
        notApplicableNote: mark?.complianceStatus === 'not_applicable' ? mark.createdBy : null,
      };
    });

    const byStatus = rows.reduce<Record<string, number>>(
      (a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a),
      {},
    );
    const byDomain = rows.reduce<Record<string, number>>(
      (a, r) => ((a[r.domain || 'other'] = (a[r.domain || 'other'] || 0) + 1), a),
      {},
    );

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
      byStatus,
      byDomain,
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
        evidenceDocumentTemplateId?: string | null;
      }>;
    },
  ) {
    await this.requireManager(tenantId, actorUserId);
    const buildingId = await this.resolveBuildingId(tenantId, buildingIdOrSlug);
    if (!body?.items?.length) throw new BadRequestException('items required');

    let applied = 0,
      marked = 0,
      removed = 0,
      skipped = 0;
    for (const it of body.items) {
      if (it.action === 'skip') {
        skipped++;
        continue;
      }

      const obligation = await this.prisma.obligationTemplate.findFirst({
        where: { id: it.obligationTemplateId, tenantId },
      });
      if (!obligation) {
        skipped++;
        continue;
      }

      if (it.action === 'not_applicable') {
        const existingPlan = await this.prisma.ppmPlanItem.findFirst({
          where: { tenantId, buildingId, obligationTemplateId: obligation.id },
        });
        if (existingPlan) {
          await this.prisma.ppmPlanItem.deleteMany({
            where: { obligationTemplateId: obligation.id, buildingId },
          });
          await this.prisma.ppmTemplate.deleteMany({
            where: { buildingId, id: existingPlan.templateId },
          });
        }
        await this.prisma.buildingObligation.upsert({
          where: {
            seedKey: `na:${buildingId}:${obligation.id}`,
          },
          create: {
            tenantId,
            buildingId,
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
          await this.prisma.ppmTemplate.deleteMany({
            where: { id: existingPlan.templateId, buildingId },
          });
        }
        await this.prisma.buildingObligation.deleteMany({
          where: {
            buildingId,
            obligationTemplateId: obligation.id,
            complianceStatus: 'not_applicable',
          },
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
        performerOrgId: it.performerOrgId === null ? null : (it.performerOrgId ?? undefined),
        contractId: it.contractId === null ? null : (it.contractId ?? undefined),
        requiresApprovalBeforeOrder: it.executionMode
          ? it.executionMode === 'ad_hoc_approved'
          : undefined,
        frequencyMonths: it.frequencyMonths ?? undefined,
        assignedRole: it.assignedRole ?? undefined,
        assignedUserId: it.assignedUserId === null ? null : (it.assignedUserId ?? undefined),
        approvalChain: it.approvalChain === null ? null : ((it.approvalChain as any) ?? undefined),
        evidenceRecipients:
          it.evidenceRecipients === null ? null : ((it.evidenceRecipients as any) ?? undefined),
        openedByRoles: it.openedByRoles ?? undefined,
        closedByRoles: it.closedByRoles ?? undefined,
        slaReminderDays: it.slaReminderDays ?? undefined,
        estimatedAnnualCost:
          it.estimatedAnnualCost === null ? null : (it.estimatedAnnualCost ?? undefined),
        estimatedCostCurrency:
          it.estimatedCostCurrency === null ? null : (it.estimatedCostCurrency ?? undefined),
        requiresPhotoEvidence: it.requiresPhotoEvidence ?? undefined,
        requiresSignoff: it.requiresSignoff ?? undefined,
        retentionYears: it.retentionYears === null ? null : (it.retentionYears ?? undefined),
        evidenceDocumentTemplateId:
          it.evidenceDocumentTemplateId === null
            ? null
            : (it.evidenceDocumentTemplateId ?? undefined),
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
            performerOrgId: it.performerOrgId === null ? null : (it.performerOrgId ?? undefined),
            contractId: it.contractId === null ? null : (it.contractId ?? undefined),
            assignedRole: it.assignedRole ?? undefined,
            assignedUserId: it.assignedUserId === null ? null : (it.assignedUserId ?? undefined),
            unitId: it.unitId === null ? null : (it.unitId ?? undefined),
          },
        });
        applied++;
      } else {
        const template = await this.prisma.ppmTemplate.create({
          data: {
            tenantId,
            buildingId,
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
            evidenceDocumentTemplateId: it.evidenceDocumentTemplateId || null,
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
        try {
          await this.prisma.ppmPlanItem.create({
            data: {
              tenantId,
              buildingId,
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
              baselineStatus: 'pending', // new wizard rows start in onboarding
              createdBy: `user:${actorUserId}`,
            },
          });
        } catch (e) {
          // Race with seed/createProgram. The template we just made is orphan —
          // clean it up and throw a clean conflict so the caller can retry the
          // batch or skip this row.
          if (isPpmPlanItemUniqueConflict(e)) {
            await this.prisma.ppmTemplate
              .delete({ where: { id: template.id } })
              .catch(() => undefined);
            throw new ConflictException(`${DUPLICATE_PLAN_ITEM_MSG} (obligation ${obligation.id})`);
          }
          throw e;
        }
        await this.prisma.buildingObligation.deleteMany({
          where: {
            buildingId,
            obligationTemplateId: obligation.id,
            complianceStatus: 'not_applicable',
          },
        });
        applied++;
      }
    }

    return { applied, marked, removed, skipped };
  }

  async getExecution(tenantId: string, taskId: string) {
    const task = await this.getTask(tenantId, taskId);
    const logs = await this.prisma.ppmExecutionLog.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: 'asc' },
    });
    let approval = null;
    if (task.approvalRequestId) {
      approval = await this.prisma.approvalRequest.findUnique({
        where: { id: task.approvalRequestId },
        include: { steps: { orderBy: { orderNo: 'asc' } } },
      });
    }
    return { task, logs, approval };
  }

  // ── Asset linkage (PPM owns the assetId column — callers from other modules
  // must route through these methods instead of writing PpmPlanItem directly).
  async listPlanItemsForAsset(tenantId: string, assetId: string, buildingId: string) {
    const [attached, available] = await Promise.all([
      this.prisma.ppmPlanItem.findMany({
        where: { tenantId, assetId },
        select: {
          id: true,
          templateId: true,
          nextDueAt: true,
          lastPerformedAt: true,
          scope: true,
          executionMode: true,
          assignedRole: true,
          baselineStatus: true,
          template: { select: { id: true, name: true, domain: true, frequencyMonths: true } },
        },
        orderBy: { nextDueAt: 'asc' },
      }),
      this.prisma.ppmPlanItem.findMany({
        where: { tenantId, buildingId, assetId: null },
        select: {
          id: true,
          templateId: true,
          nextDueAt: true,
          scope: true,
          executionMode: true,
          assignedRole: true,
          baselineStatus: true,
          template: { select: { id: true, name: true, domain: true, frequencyMonths: true } },
        },
        orderBy: [{ baselineStatus: 'asc' }, { nextDueAt: 'asc' }],
      }),
    ]);
    return { attached, available };
  }

  async attachPlanItemToAsset(
    tenantId: string,
    planItemId: string,
    assetId: string,
    buildingId: string,
  ) {
    const p = await this.prisma.ppmPlanItem.findFirst({ where: { id: planItemId, tenantId } });
    if (!p) throw new NotFoundException('plan item not found');
    if (p.buildingId !== buildingId) {
      throw new BadRequestException('plan item belongs to a different building');
    }
    if (p.assetId && p.assetId !== assetId) {
      throw new BadRequestException(
        'plan item is already attached to another asset — detach it first',
      );
    }
    return this.prisma.ppmPlanItem.update({
      where: { id: planItemId },
      data: { assetId },
    });
  }

  async detachPlanItemFromAsset(tenantId: string, planItemId: string, assetId: string) {
    const p = await this.prisma.ppmPlanItem.findFirst({
      where: { id: planItemId, tenantId, assetId },
    });
    if (!p) throw new NotFoundException('plan item not attached to this asset');
    const updated = await this.prisma.ppmPlanItem.update({
      where: { id: planItemId },
      data: { assetId: null },
    });
    return updated;
  }

  // ── Seed ──────────────────────────────────────────────
  // Bootstrap a newly-created building with one PpmPlanItem per active tenant
  // obligation template, in baselineStatus='pending'. Idempotent: rows that
  // already exist for (tenantId, buildingId, obligationTemplateId, scope=building_common)
  // are left untouched. Safe to call any time to "catch up" a building that was
  // created before this method existed.
  //
  // Called by BuildingsService.create after the building row + settings land.
  // The building module does NOT write to ppm_* tables — it calls this method
  // so PPM remains the single writer of its own tables.
  async seedPendingPlanItemsForBuilding(params: {
    tenantId: string;
    buildingId: string;
    actorUserId?: string;
  }): Promise<{ created: number; skipped: number; total: number }> {
    const { tenantId, buildingId } = params;
    const [obligations, existing] = await Promise.all([
      this.prisma.obligationTemplate.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          domain: true,
          recurrenceRule: true,
          requiredDocumentTypeKey: true,
        },
      }),
      this.prisma.ppmPlanItem.findMany({
        where: { tenantId, buildingId, scope: 'building_common' },
        select: { obligationTemplateId: true },
      }),
    ]);
    const already = new Set(existing.map((p) => p.obligationTemplateId));
    let created = 0;
    let skipped = 0;
    const actor = params.actorUserId ? `user:${params.actorUserId}` : 'system:seed-pending';
    const defaultNextDue = new Date(Date.now() + 365 * 86400000);

    for (const o of obligations) {
      if (already.has(o.id)) {
        skipped += 1;
        continue;
      }
      const tpl = await this.prisma.ppmTemplate.create({
        data: {
          tenantId,
          buildingId,
          name: o.name,
          domain: o.domain || null,
          scope: 'building_common',
          executionMode: 'in_house',
          requiresApprovalBeforeOrder: false,
          evidenceDocTypeKey: o.requiredDocumentTypeKey || null,
          createdBy: actor,
        },
      });
      try {
        await this.prisma.ppmPlanItem.create({
          data: {
            tenantId,
            buildingId,
            templateId: tpl.id,
            obligationTemplateId: o.id,
            assignedRole: 'maintenance_coordinator',
            recurrenceRule: o.recurrenceRule,
            nextDueAt: defaultNextDue,
            scope: 'building_common',
            executionMode: 'in_house',
            baselineStatus: 'pending',
            createdBy: actor,
          },
        });
        created += 1;
      } catch (e) {
        // A parallel seed / wizard call already created the plan item between
        // our findMany and create. Clean up the orphan template and count it
        // as skipped — idempotency preserved, no exception bubbles up.
        if (isPpmPlanItemUniqueConflict(e)) {
          await this.prisma.ppmTemplate.delete({ where: { id: tpl.id } }).catch(() => undefined);
          skipped += 1;
          continue;
        }
        throw e;
      }
    }
    return { created, skipped, total: obligations.length };
  }
}
