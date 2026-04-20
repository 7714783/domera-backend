import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SeedRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getWorkspaceBySlug(slug: string) {
    const workspace = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const [organizationsCount, userMemberships, buildingsCount] = await Promise.all([
      this.prisma.organization.count({ where: { tenantId: workspace.id } }),
      this.prisma.membership.findMany({ where: { tenantId: workspace.id }, distinct: ['userId'], select: { userId: true } }),
      this.prisma.building.count({ where: { tenantId: workspace.id } }),
    ]);

    return {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      isDemo: workspace.isDemo,
      organizationsCount,
      usersCount: userMemberships.length,
      buildingsCount,
      demo: workspace.isDemo,
    };
  }

  private async getBuildingBySlug(slug: string) {
    const building = await this.prisma.building.findFirst({
      where: { slug },
    });

    if (!building) {
      throw new NotFoundException('Building not found');
    }

    return building;
  }

  async getAssetsTree(slug: string) {
    const building = await this.getBuildingBySlug(slug);
    const assets = await this.prisma.asset.findMany({
      where: { buildingId: building.id },
      orderBy: { name: 'asc' },
    });

    const byParent = new Map<string | null, any[]>();
    for (const asset of assets) {
      const key = asset.parentAssetId || null;
      const list = byParent.get(key) || [];
      list.push(asset);
      byParent.set(key, list);
    }

    const buildNode = (parentId: string | null): any[] => {
      return (byParent.get(parentId) || []).map((asset) => ({
        ...asset,
        children: buildNode(asset.id),
      }));
    };

    return {
      building,
      total: assets.length,
      tree: buildNode(null),
    };
  }

  async getBuildingOverview(slug: string) {
    const building = await this.getBuildingBySlug(slug);

    const [assetsCount, obligationsCount, ppmPlanItemsCount, tasks] = await Promise.all([
      this.prisma.asset.count({ where: { buildingId: building.id } }),
      this.prisma.buildingObligation.count({ where: { buildingId: building.id } }),
      this.prisma.ppmPlanItem.count({ where: { buildingId: building.id } }),
      this.prisma.taskInstance.findMany({ where: { buildingId: building.id }, select: { status: true } }),
    ]);

    return {
      building,
      kpis: {
        assets: assetsCount,
        obligations: obligationsCount,
        ppmPlanItems: ppmPlanItemsCount,
        openTasks: tasks.filter((x) => x.status === 'open').length,
        overdueTasks: tasks.filter((x) => x.status === 'overdue').length,
        blockedTasks: tasks.filter((x) => x.status === 'blocked').length,
        completedTasks: tasks.filter((x) => x.status === 'completed').length,
      },
    };
  }

  async getBuildingComplianceDashboard(slug: string) {
    const building = await this.getBuildingBySlug(slug);
    const tasks = await this.prisma.taskInstance.findMany({ where: { buildingId: building.id } });

    const overdue = tasks.filter((x) => x.status === 'overdue').length;
    const due30 = tasks.filter((x) => x.status === 'open' && x.dueAt <= new Date(Date.now() + 30 * 86400000)).length;
    const missingEvidence = tasks.filter((x) => x.evidenceRequired && (!x.evidenceDocuments || (Array.isArray(x.evidenceDocuments) && x.evidenceDocuments.length === 0)) && x.status !== 'open').length;
    const blockedApproval = tasks.filter((x) => x.blockedReason === 'missing_approval').length;
    const blockedDocument = tasks.filter((x) => x.blockedReason === 'missing_document').length;

    const score = Math.max(0, 100 - overdue * 8 - blockedApproval * 5 - blockedDocument * 5);

    return {
      building,
      overdue_count: overdue,
      due_30_count: due30,
      missing_evidence_count: missingEvidence,
      blocked_by_approval_count: blockedApproval,
      blocked_by_document_count: blockedDocument,
      risk_score: score >= 90 ? 'A' : score >= 75 ? 'B+' : score >= 60 ? 'C' : 'D',
      score,
    };
  }

  async getBuildingBudgets(slug: string) {
    const building = await this.getBuildingBySlug(slug);
    const [budgets, invoices] = await Promise.all([
      this.prisma.budget.findMany({ where: { buildingId: building.id }, include: { lines: true }, orderBy: { fiscalYear: 'desc' } }),
      this.prisma.invoice.findMany({ where: { buildingId: building.id }, orderBy: { createdAt: 'desc' } }),
    ]);

    return { building, budgets, invoices };
  }

  async getBuildingApprovals(slug: string) {
    const building = await this.getBuildingBySlug(slug);
    const approvals = await this.prisma.approvalRequest.findMany({
      where: { buildingId: building.id },
      include: { steps: { orderBy: { orderNo: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return { building, approvals };
  }

  async getBuildingDocuments(slug: string) {
    const building = await this.getBuildingBySlug(slug);
    const documents = await this.prisma.document.findMany({ where: { buildingId: building.id }, orderBy: { createdAt: 'desc' } });
    return { building, documents };
  }

  async getBuildingAudit(slug: string) {
    const building = await this.getBuildingBySlug(slug);
    const items = await this.prisma.auditEntry.findMany({
      where: { buildingId: building.id },
      orderBy: { timestamp: 'desc' },
    });
    return { building, total: items.length, items };
  }

  async completeTask(taskId: string, payload: any, actorUserId: string) {
    const task = await this.prisma.taskInstance.findUnique({ where: { id: taskId }, include: { building: true } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (task.evidenceRequired && (!payload?.evidence_documents || payload.evidence_documents.length === 0)) {
      throw new Error('evidence required');
    }

    const updated = await this.prisma.taskInstance.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        completedAt: payload?.completed_at ? new Date(payload.completed_at) : new Date(),
        result: payload?.result || 'passed',
        evidenceDocuments: payload?.evidence_documents || [],
      },
    });

    await this.audit.write({
      tenantId: updated.tenantId,
      buildingId: updated.buildingId,
      actor: actorUserId, role: 'operator',
      action: 'Task completed', entity: updated.title, entityType: 'task',
      building: task.building.name, ip: '127.0.0.1', sensitive: false,
      eventType: 'task.completed', resourceType: 'task', resourceId: updated.id,
      metadata: { comment: payload?.comment || null },
    });

    return updated;
  }

  async approveChain(approvalId: string, payload: any, actorRole: string, actorUserId: string) {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: { steps: { orderBy: { orderNo: 'asc' } }, building: true },
    });

    if (!approval) {
      throw new NotFoundException('Approval not found');
    }

    if (actorRole === 'technician') {
      throw new Error('technician cannot approve spend');
    }

    const pendingStep = approval.steps.find((x) => x.status === 'pending');
    if (!pendingStep) {
      return approval;
    }

    if (approval.type === 'spend_approval') {
      if (actorRole === 'building_manager' && approval.amount > 25000) {
        throw new Error('building_manager limit exceeded');
      }
      if (pendingStep.orderNo === 3 && approval.amount > 50000 && actorRole !== 'owner_representative') {
        throw new Error('owner_representative required for L3 approval above 50000 ILS');
      }
    }

    await this.prisma.approvalStep.update({
      where: { id: pendingStep.id },
      data: {
        status: payload?.decision === 'reject' ? 'rejected' : 'approved',
        actedByUserId: actorUserId,
        actedAt: new Date(),
      },
    });

    const fresh = await this.prisma.approvalRequest.findUnique({
      where: { id: approval.id },
      include: { steps: true, building: true },
    });

    if (!fresh) {
      throw new NotFoundException('Approval not found');
    }

    const hasRejected = fresh.steps.some((x) => x.status === 'rejected');
    const allApproved = fresh.steps.every((x) => x.status === 'approved');

    const updatedApproval = await this.prisma.approvalRequest.update({
      where: { id: fresh.id },
      data: {
        status: hasRejected ? 'rejected' : allApproved ? 'approved' : 'pending',
      },
      include: { steps: { orderBy: { orderNo: 'asc' } } },
    });

    await this.audit.write({
      tenantId: approval.tenantId,
      buildingId: approval.buildingId,
      actor: actorUserId, role: actorRole,
      action: 'Approval step approved', entity: approval.title, entityType: 'approval',
      building: approval.building.name, ip: '127.0.0.1',
      sensitive: approval.type === 'spend_approval',
      eventType: 'approval.step.approved', resourceType: 'approval', resourceId: approval.id,
      metadata: { decision: payload?.decision || 'approve', comment: payload?.comment || null },
    });

    return updatedApproval;
  }
}
