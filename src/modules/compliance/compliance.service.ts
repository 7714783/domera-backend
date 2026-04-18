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

@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(tenantId: string): Promise<ComplianceDashboard> {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [tasks, buildings] = await Promise.all([
      this.prisma.taskInstance.findMany({
        where: { tenantId },
        include: { building: true },
      }),
      this.prisma.building.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    ]);

    const overdue = tasks.filter((t) => t.status === 'overdue');
    const upcoming = tasks.filter((t) => t.status === 'open' && t.dueAt <= in30);
    const missingEvidence = tasks.filter(
      (t) => t.evidenceRequired && (!t.evidenceDocuments || (Array.isArray(t.evidenceDocuments) && t.evidenceDocuments.length === 0)),
    );
    const blockedByApproval = tasks.filter((t) => t.blockedReason === 'missing_approval');

    const total = tasks.length || 1;
    const compliantPct = Math.round((tasks.filter((t) => t.status === 'completed').length / total) * 100);
    const warningPct = Math.round((tasks.filter((t) => t.status === 'blocked').length / total) * 100);
    const overduePct = Math.round((tasks.filter((t) => t.status === 'overdue').length / total) * 100);
    const pendingPct = Math.max(0, 100 - compliantPct - warningPct - overduePct);

    const byBuilding = buildings.map((building) => {
      const bTasks = tasks.filter((t) => t.buildingId === building.id);
      const bTotal = bTasks.length || 1;
      return {
        building: building.name,
        compliant: Math.round((bTasks.filter((t) => t.status === 'completed').length / bTotal) * 100),
        warning: Math.round((bTasks.filter((t) => t.status === 'blocked').length / bTotal) * 100),
        overdue: Math.round((bTasks.filter((t) => t.status === 'overdue').length / bTotal) * 100),
      };
    });

    const overdueItems = overdue.slice(0, 12).map((task) => {
      const days = Math.max(1, Math.floor((now.getTime() - task.dueAt.getTime()) / (24 * 60 * 60 * 1000)));
      const hasEvidence = Array.isArray(task.evidenceDocuments) && task.evidenceDocuments.length > 0;
      return {
        id: task.id,
        title: task.title,
        building: task.building.name,
        dueDate: task.dueAt.toISOString().slice(0, 10),
        daysOverdue: days,
        evidence: hasEvidence ? ('required' as const) : ('missing' as const),
      };
    });

    const scoreValue = Math.max(0, 100 - overdue.length * 8 - blockedByApproval.length * 5);
    const riskScore = scoreValue >= 90 ? 'A' : scoreValue >= 75 ? 'B+' : scoreValue >= 60 ? 'C' : 'D';

    return {
      summary: {
        overdueStatutory: overdue.length,
        upcoming30Days: upcoming.length,
        missingEvidence: missingEvidence.length,
        unqualifiedAssignments: 0,
        blockedByApproval: blockedByApproval.length,
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
