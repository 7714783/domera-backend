import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ComplianceDashboard {
  summary: {
    overdueStatutory: number;
    upcoming30Days: number;
    missingEvidence: number;
    unqualifiedAssignments: number;
    blockedByApproval: number;
    riskScore: string;
  };
  statusDistribution: {
    compliant: number;
    warning: number;
    overdue: number;
    pending: number;
  };
  byBuilding: Array<{
    building: string;
    compliant: number;
    warning: number;
    overdue: number;
  }>;
  overdueItems: Array<{
    id: string;
    title: string;
    building: string;
    dueDate: string;
    daysOverdue: number;
    evidence: 'required' | 'missing';
  }>;
}

const BLOCKED_STAGES = ['quote_requested', 'quote_received', 'awaiting_approval'];
const CLOSED_STAGES = ['completed', 'evidence_distributed', 'archived'];

@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(tenantId: string): Promise<ComplianceDashboard> {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [planItems, tasks, buildings] = await Promise.all([
      this.prisma.ppmPlanItem.findMany({
        // Exclude plan items still in baseline pending — they haven't been
        // onboarded into the main flow yet, so they must not pollute
        // compliance counters as "overdue".
        where: { tenantId, baselineStatus: { not: 'pending' } },
        include: {
          building: { select: { id: true, name: true } },
          template: { select: { name: true, evidenceDocTypeKey: true } },
          obligation: { select: { requiredCertificationKey: true } },
        },
      }),
      this.prisma.taskInstance.findMany({
        where: { tenantId },
        include: { building: { select: { id: true, name: true } } },
      }),
      this.prisma.building.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    ]);

    const overduePlans = planItems.filter((p) => p.nextDueAt.getTime() < now.getTime());
    const upcomingPlans = planItems.filter(
      (p) => p.nextDueAt.getTime() >= now.getTime() && p.nextDueAt.getTime() <= in30.getTime(),
    );
    const blockedTasks = tasks.filter((t) => BLOCKED_STAGES.includes(t.lifecycleStage));

    const missingEvidence = tasks.filter((t) => {
      if (!CLOSED_STAGES.includes(t.lifecycleStage)) return false;
      if (!t.evidenceRequired) return false;
      const docs = t.evidenceDocuments;
      const hasDocs = Array.isArray(docs) && docs.length > 0;
      return !hasDocs && !t.serviceReportDocumentId;
    });

    const totalPlans = planItems.length || 1;
    const compliantPct = Math.round(
      (planItems.filter((p) => p.nextDueAt.getTime() > in30.getTime()).length / totalPlans) * 100,
    );
    const overduePct = Math.round((overduePlans.length / totalPlans) * 100);
    const warningPct = Math.round((upcomingPlans.length / totalPlans) * 100);
    const pendingPct = Math.max(0, 100 - compliantPct - warningPct - overduePct);

    const byBuilding = buildings.map((building) => {
      const bPlans = planItems.filter((p) => p.buildingId === building.id);
      const bTotal = bPlans.length || 1;
      const bOverdue = bPlans.filter((p) => p.nextDueAt.getTime() < now.getTime()).length;
      const bWarning = bPlans.filter(
        (p) => p.nextDueAt.getTime() >= now.getTime() && p.nextDueAt.getTime() <= in30.getTime(),
      ).length;
      const bCompliant = bPlans.filter((p) => p.nextDueAt.getTime() > in30.getTime()).length;
      return {
        building: building.name,
        compliant: Math.round((bCompliant / bTotal) * 100),
        warning: Math.round((bWarning / bTotal) * 100),
        overdue: Math.round((bOverdue / bTotal) * 100),
      };
    });

    const overdueItems = overduePlans
      .sort((a, b) => a.nextDueAt.getTime() - b.nextDueAt.getTime())
      .slice(0, 12)
      .map((p) => {
        const days = Math.max(
          1,
          Math.floor((now.getTime() - p.nextDueAt.getTime()) / (24 * 60 * 60 * 1000)),
        );
        const needsEvidence = !!(p as any).template?.evidenceDocTypeKey;
        return {
          id: p.id,
          title: (p as any).template?.name ?? 'PPM plan',
          building: p.building.name,
          dueDate: p.nextDueAt.toISOString().slice(0, 10),
          daysOverdue: days,
          evidence: needsEvidence ? ('required' as const) : ('missing' as const),
        };
      });

    const unqualifiedAssignments = planItems.filter((p) => {
      const reqCert = (p as any).obligation?.requiredCertificationKey;
      return !!reqCert && !p.assignedUserId;
    }).length;

    const scoreValue = Math.max(
      0,
      100 - overduePlans.length * 6 - blockedTasks.length * 4 - missingEvidence.length * 3,
    );
    const riskScore =
      scoreValue >= 90 ? 'A' : scoreValue >= 75 ? 'B+' : scoreValue >= 60 ? 'C' : 'D';

    return {
      summary: {
        overdueStatutory: overduePlans.length,
        upcoming30Days: upcomingPlans.length,
        missingEvidence: missingEvidence.length,
        unqualifiedAssignments,
        blockedByApproval: blockedTasks.length,
        riskScore,
      },
      statusDistribution: {
        compliant: compliantPct,
        warning: warningPct,
        overdue: overduePct,
        pending: pendingPct,
      },
      byBuilding,
      overdueItems,
    };
  }
}
