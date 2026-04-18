import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalItem, ApprovalStatus } from './approvals.types';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private mapType(type: string): 'spend' | 'document' | 'compliance' {
    if (type.includes('spend')) return 'spend';
    if (type.includes('document')) return 'document';
    return 'compliance';
  }

  private toItem(request: any): ApprovalItem {
    const steps = [...request.steps].sort((a, b) => a.orderNo - b.orderNo);
    const totalSteps = steps.length;
    const approvedCount = steps.filter((x: any) => x.status === 'approved').length;
    const pendingExists = steps.some((x: any) => x.status === 'pending');
    const step = pendingExists ? Math.min(totalSteps, approvedCount + 1) : totalSteps;

    return {
      id: request.id,
      tenantId: request.tenantId,
      title: request.title,
      type: this.mapType(request.type),
      amount: request.amount ? `$${request.amount.toLocaleString()}` : null,
      building: request.building?.name || 'Unknown building',
      requester: request.requesterName || 'System',
      step,
      totalSteps,
      status: request.status as ApprovalStatus,
      threshold: request.threshold || null,
      hint: request.hint || null,
      createdAt: request.createdAt.toISOString(),
    };
  }

  async list(tenantId: string): Promise<ApprovalItem[]> {
    const requests = await this.prisma.approvalRequest.findMany({
      where: { tenantId },
      include: {
        building: true,
        steps: { orderBy: { orderNo: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((request) => this.toItem(request));
  }

  async approve(
    tenantId: string,
    id: string,
    actorRole = 'finance_controller',
    actorName = 'System Operator',
  ): Promise<ApprovalItem | null> {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { tenantId, id },
      include: {
        building: true,
        steps: { orderBy: { orderNo: 'asc' } },
      },
    });

    if (!request) {
      return null;
    }

    const pendingStep = request.steps.find((x) => x.status === 'pending');
    if (!pendingStep) {
      return this.toItem(request);
    }

    if (pendingStep.role !== actorRole) {
      // allow owner representative to approve final L3 explicitly
      const allowedOverride = actorRole === 'owner_representative' && pendingStep.orderNo === request.steps.length;
      if (!allowedOverride) {
        throw new Error(`Current pending step requires role: ${pendingStep.role}`);
      }
    }

    if (request.type === 'spend_approval') {
      if (actorRole === 'technician') {
        throw new Error('technician cannot approve spend');
      }
      if (actorRole === 'building_manager' && request.amount > 25000) {
        throw new Error('building_manager limit exceeded');
      }
      if (pendingStep.orderNo === 3 && request.amount > 50000 && actorRole !== 'owner_representative') {
        throw new Error('owner_representative required for L3 approval above 50000 ILS');
      }
    }

    await this.prisma.approvalStep.update({
      where: { id: pendingStep.id },
      data: {
        status: 'approved',
        actedByUserId: actorName,
        actedAt: new Date(),
      },
    });

    const fresh = await this.prisma.approvalRequest.findUnique({
      where: { id: request.id },
      include: {
        building: true,
        steps: { orderBy: { orderNo: 'asc' } },
      },
    });

    if (!fresh) {
      return null;
    }

    const allApproved = fresh.steps.every((x) => x.status === 'approved');
    const hasRejected = fresh.steps.some((x) => x.status === 'rejected');

    await this.prisma.approvalRequest.update({
      where: { id: fresh.id },
      data: {
        status: hasRejected ? 'rejected' : allApproved ? 'approved' : 'pending',
      },
    });

    await this.auditService.write({
      tenantId,
      actor: actorName,
      role: actorRole,
      action: 'Approved request',
      entity: request.title,
      entityType: 'approval',
      building: request.building?.name || 'Unknown building',
      ip: '127.0.0.1',
      sensitive: request.type === 'spend_approval',
    });

    const finalRequest = await this.prisma.approvalRequest.findUnique({
      where: { id: fresh.id },
      include: {
        building: true,
        steps: { orderBy: { orderNo: 'asc' } },
      },
    });

    return finalRequest ? this.toItem(finalRequest) : null;
  }

  summary(items: ApprovalItem[]): Record<'all' | ApprovalStatus, number> {
    return {
      all: items.length,
      pending: items.filter((x) => x.status === 'pending').length,
      approved: items.filter((x) => x.status === 'approved').length,
      rejected: items.filter((x) => x.status === 'rejected').length,
      escalated: items.filter((x) => x.status === 'escalated').length,
    };
  }
}
