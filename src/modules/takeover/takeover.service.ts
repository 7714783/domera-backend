import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BuildingsService } from '../buildings/buildings.service';

const SIGNOFF_CHAIN = ['building_manager', 'chief_engineer', 'owner_representative'];

@Injectable()
export class TakeoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly buildings: BuildingsService,
  ) {}

  async createCase(
    tenantId: string,
    actorUserId: string,
    body: {
      buildingSlug: string;
      outgoingOrgSeedKey?: string;
      incomingOrgSeedKey?: string;
      targetGoLiveAt?: string;
    },
  ) {
    const building = await this.prisma.building.findFirst({
      where: { tenantId, slug: body.buildingSlug },
    });
    if (!building) throw new NotFoundException('building not found');

    const outgoing = body.outgoingOrgSeedKey
      ? await this.prisma.organization.findFirst({
          where: { tenantId, seedKey: body.outgoingOrgSeedKey },
        })
      : null;
    const incoming = body.incomingOrgSeedKey
      ? await this.prisma.organization.findFirst({
          where: { tenantId, seedKey: body.incomingOrgSeedKey },
        })
      : null;

    const c = await this.prisma.takeoverCase.create({
      data: {
        tenantId,
        buildingId: building.id,
        outgoingOrgId: outgoing?.id || null,
        incomingOrgId: incoming?.id || null,
        targetGoLiveAt: body.targetGoLiveAt ? new Date(body.targetGoLiveAt) : null,
        status: 'draft',
        createdByUserId: actorUserId,
      },
    });

    await this.audit.write({
      tenantId,
      buildingId: building.id,
      actor: actorUserId,
      role: 'initiator',
      action: 'Takeover case created',
      entity: c.id,
      entityType: 'takeover_case',
      building: building.name,
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'takeover.created',
      resourceType: 'takeover_case',
      resourceId: c.id,
    });
    return c;
  }

  async gapAnalysis(tenantId: string, caseId: string) {
    const c = await this.prisma.takeoverCase.findFirst({ where: { id: caseId, tenantId } });
    if (!c) throw new NotFoundException('takeover case not found');

    const statutoryTemplates = await this.prisma.obligationTemplate.findMany({
      where: { tenantId, bases: { some: { type: 'statutory' } } },
      include: { buildingLinks: { where: { buildingId: c.buildingId } }, applicabilityRules: true },
    });

    const ctx = await this.buildingContext(c.buildingId);
    const missingStatutory: Array<{ id: string; name: string; domain: string | null }> = [];
    for (const t of statutoryTemplates) {
      const applicable =
        t.applicabilityRules.length === 0 ||
        t.applicabilityRules.every((r) => this.evalPredicate(r.predicate as any, ctx));
      if (applicable && t.buildingLinks.length === 0) {
        missingStatutory.push({ id: t.id, name: t.name, domain: t.domain });
      }
    }

    const tasks = await this.prisma.taskInstance.findMany({
      where: { tenantId, buildingId: c.buildingId },
      select: {
        id: true,
        title: true,
        status: true,
        dueAt: true,
        evidenceRequired: true,
        evidenceDocuments: true,
        requiredCertificationKey: true,
        completedByUserId: true,
      },
    });
    const overdueCompletions = tasks.filter((t) => t.status === 'overdue');
    const missingEvidence = tasks.filter(
      (t) =>
        t.evidenceRequired &&
        (!t.evidenceDocuments ||
          (Array.isArray(t.evidenceDocuments) && (t.evidenceDocuments as any[]).length === 0)) &&
        t.status !== 'open',
    );

    const qualifiedCerts = await this.prisma.userCertification.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { certification: { select: { key: true } } },
    });
    const availableCertKeys = new Set(qualifiedCerts.map((uc) => uc.certification.key));
    const qualificationGaps = tasks
      .filter(
        (t) => t.requiredCertificationKey && !availableCertKeys.has(t.requiredCertificationKey),
      )
      .map((t) => ({
        id: t.id,
        title: t.title,
        requiredCertificationKey: t.requiredCertificationKey,
      }));

    const redList = missingStatutory.slice(0, 25);

    return {
      caseId: c.id,
      missing_statutory: missingStatutory,
      overdue_completions: overdueCompletions.map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt.toISOString(),
      })),
      missing_evidence: missingEvidence.map((t) => ({ id: t.id, title: t.title })),
      qualification_gaps: qualificationGaps,
      red_list: redList,
      summary: {
        missing_statutory: missingStatutory.length,
        overdue: overdueCompletions.length,
        missing_evidence: missingEvidence.length,
        qualification_gaps: qualificationGaps.length,
      },
    };
  }

  /**
   * Readiness scoring: what fraction of the operational checklist is in place
   * for a takeover case? Weighted blend of mandatory-doc coverage, overdue
   * count, missing evidence, and qualification gaps. Returns a 0..100 score
   * with component breakdown — intended for the takeover UI dial.
   *
   * Weights (sum = 100):
   *   mandatoryDocsPresent    40
   *   overdueTasksResolved    25
   *   evidencePresent         20
   *   qualificationsSatisfied 15
   */
  async readinessScore(tenantId: string, caseId: string) {
    const gap = await this.gapAnalysis(tenantId, caseId);

    const c = await this.prisma.takeoverCase.findFirst({
      where: { id: caseId, tenantId },
      select: { buildingId: true, signedOffAt: true, status: true },
    });
    if (!c) throw new NotFoundException('takeover case not found');

    // Mandatory documents presence: ratio of ObligationTemplate.requiredDocumentTypeKey
    // that has at least one Document of that type in the building.
    const templates = await this.prisma.obligationTemplate.findMany({
      where: { tenantId, requiredDocumentTypeKey: { not: null } },
      select: {
        requiredDocumentTypeKey: true,
        buildingLinks: { where: { buildingId: c.buildingId }, select: { id: true } },
      },
    });
    const applicableDocKeys = [
      ...new Set(
        templates
          .filter((t) => t.buildingLinks.length > 0 && t.requiredDocumentTypeKey)
          .map((t) => t.requiredDocumentTypeKey as string),
      ),
    ];
    let presentDocKeys = 0;
    if (applicableDocKeys.length > 0) {
      const docs = await this.prisma.document.findMany({
        where: { tenantId, buildingId: c.buildingId, documentTypeKey: { in: applicableDocKeys } },
        select: { documentTypeKey: true },
      });
      const present = new Set(docs.map((d) => d.documentTypeKey).filter(Boolean) as string[]);
      presentDocKeys = applicableDocKeys.filter((k) => present.has(k)).length;
    }
    const mandatoryDocsPct =
      applicableDocKeys.length === 0
        ? 100
        : Math.round((presentDocKeys / applicableDocKeys.length) * 100);

    // Overdue ratio: penalty scaled against total tasks.
    const totalTasks = await this.prisma.taskInstance.count({
      where: { tenantId, buildingId: c.buildingId },
    });
    const overduePct =
      totalTasks === 0 ? 100 : Math.round(((totalTasks - gap.summary.overdue) / totalTasks) * 100);

    // Evidence presence on completed tasks.
    const completedCount = await this.prisma.taskInstance.count({
      where: {
        tenantId,
        buildingId: c.buildingId,
        lifecycleStage: { in: ['completed', 'evidence_distributed', 'archived'] },
      },
    });
    const evidencePct =
      completedCount === 0
        ? 100
        : Math.round(((completedCount - gap.summary.missing_evidence) / completedCount) * 100);

    // Qualification coverage: fraction of tasks whose certification requirement is met.
    const certGapCount = gap.summary.qualification_gaps;
    const certRequiredCount = await this.prisma.taskInstance.count({
      where: { tenantId, buildingId: c.buildingId, requiredCertificationKey: { not: null } },
    });
    const qualPct =
      certRequiredCount === 0
        ? 100
        : Math.round(((certRequiredCount - certGapCount) / certRequiredCount) * 100);

    const score = Math.round(
      0.4 * mandatoryDocsPct + 0.25 * overduePct + 0.2 * evidencePct + 0.15 * qualPct,
    );
    const grade =
      score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

    return {
      caseId,
      score,
      grade,
      components: {
        mandatoryDocsPresent: {
          pct: mandatoryDocsPct,
          weight: 40,
          present: presentDocKeys,
          total: applicableDocKeys.length,
        },
        overdueTasksResolved: {
          pct: overduePct,
          weight: 25,
          overdue: gap.summary.overdue,
          totalTasks,
        },
        evidencePresent: {
          pct: evidencePct,
          weight: 20,
          missingEvidence: gap.summary.missing_evidence,
          completedTasks: completedCount,
        },
        qualificationsSatisfied: {
          pct: qualPct,
          weight: 15,
          gaps: certGapCount,
          certRequired: certRequiredCount,
        },
      },
      canSignoff: score >= 75 && gap.summary.missing_statutory === 0,
      blockers: [
        ...(gap.summary.missing_statutory > 0
          ? [`${gap.summary.missing_statutory} mandatory obligations not linked to building`]
          : []),
        ...(score < 75 ? [`overall readiness ${score}% below signoff threshold 75%`] : []),
      ],
    };
  }

  async signoff(tenantId: string, caseId: string, actorUserId: string, actorRole: string) {
    const c = await this.prisma.takeoverCase.findFirst({ where: { id: caseId, tenantId } });
    if (!c) throw new NotFoundException('takeover case not found');
    if (!SIGNOFF_CHAIN.includes(actorRole))
      throw new ForbiddenException('role cannot sign off takeover');

    const log = Array.isArray(c.signoffLog as any) ? [...(c.signoffLog as any[])] : [];
    const already = log.find((x: any) => x.role === actorRole);
    if (already) throw new BadRequestException(`role already signed: ${actorRole}`);

    const expectedNext = SIGNOFF_CHAIN[log.length];
    if (expectedNext !== actorRole)
      throw new BadRequestException(
        `signoff order violated: expected ${expectedNext}, got ${actorRole}`,
      );

    log.push({ role: actorRole, userId: actorUserId, at: new Date().toISOString() });
    const completed = log.length === SIGNOFF_CHAIN.length;

    const updated = await this.prisma.takeoverCase.update({
      where: { id: c.id },
      data: {
        signoffLog: log,
        status: completed ? 'completed' : 'in_signoff',
        signedOffAt: completed ? new Date() : null,
      },
    });

    if (completed) {
      await this.buildings.setStatus(tenantId, c.buildingId, 'operational');
    }

    await this.audit.write({
      tenantId,
      buildingId: c.buildingId,
      actor: actorUserId,
      role: actorRole,
      action: completed ? 'Takeover signed off' : 'Takeover signoff step',
      entity: c.id,
      entityType: 'takeover_case',
      building: c.buildingId,
      ip: '127.0.0.1',
      sensitive: false,
      eventType: completed ? 'takeover.completed' : 'takeover.signoff.step',
      resourceType: 'takeover_case',
      resourceId: c.id,
      metadata: { step: actorRole, log },
    });
    return updated;
  }

  private evalPredicate(
    predicate: { attr: string; op: string; value: number | string },
    ctx: Record<string, any>,
  ): boolean {
    const v = ctx[predicate.attr];
    if (v === null || v === undefined) return false;
    switch (predicate.op) {
      case '>':
        return Number(v) > Number(predicate.value);
      case '>=':
        return Number(v) >= Number(predicate.value);
      case '<':
        return Number(v) < Number(predicate.value);
      case '<=':
        return Number(v) <= Number(predicate.value);
      case '=':
      case '==':
        return String(v) === String(predicate.value);
      default:
        return false;
    }
  }

  private async buildingContext(
    buildingId: string,
  ): Promise<Record<string, number | string | null>> {
    const b = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!b) return {};
    return {
      'building.floors_count': b.floorsCount ?? null,
      'building.annual_kwh': b.annualKwh ?? null,
      'building.country_code': b.countryCode,
    };
  }
}
