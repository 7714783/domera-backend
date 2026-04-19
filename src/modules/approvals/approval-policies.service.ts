import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type PolicyStep = {
  orderNo: number;
  role: string;
  mandatory?: boolean;
  escalateAfterHours?: number;
};

function normaliseSteps(raw: unknown): PolicyStep[] {
  if (!Array.isArray(raw)) throw new BadRequestException('stepsJson must be an array');
  const out: PolicyStep[] = [];
  const seenOrders = new Set<number>();
  for (const s of raw) {
    if (!s || typeof s !== 'object') throw new BadRequestException('policy step must be object');
    const step = s as any;
    if (typeof step.orderNo !== 'number' || step.orderNo < 1) throw new BadRequestException('step.orderNo must be >= 1');
    if (typeof step.role !== 'string' || !step.role) throw new BadRequestException('step.role required');
    if (seenOrders.has(step.orderNo)) throw new BadRequestException(`duplicate orderNo ${step.orderNo}`);
    seenOrders.add(step.orderNo);
    out.push({
      orderNo: step.orderNo,
      role: step.role,
      mandatory: step.mandatory !== false,
      escalateAfterHours: typeof step.escalateAfterHours === 'number' ? step.escalateAfterHours : undefined,
    });
  }
  out.sort((a, b) => a.orderNo - b.orderNo);
  return out;
}

@Injectable()
export class ApprovalPoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, actorUserId: string, body: {
    name: string;
    type: string;
    buildingId?: string | null;
    currency?: string;
    minAmount?: number;
    maxAmount?: number | null;
    stepsJson: PolicyStep[];
    effectiveFrom?: string;
    effectiveUntil?: string | null;
    supersedesId?: string | null;
  }) {
    if (!body.name || !body.type) throw new BadRequestException('name, type required');
    const steps = normaliseSteps(body.stepsJson);
    if (!steps.length) throw new BadRequestException('policy requires ≥1 step');

    // Version: next version after the most-recent active matching (name+type+buildingId)
    const prev = await this.prisma.approvalPolicy.findFirst({
      where: { tenantId, name: body.name, type: body.type, buildingId: body.buildingId ?? null },
      orderBy: { version: 'desc' },
    });
    const version = prev ? prev.version + 1 : 1;

    const created = await this.prisma.$transaction(async (tx) => {
      // Archive previous active
      if (prev && prev.isActive) {
        await tx.approvalPolicy.update({
          where: { id: prev.id },
          data: { isActive: false, effectiveUntil: new Date() },
        });
      }
      return tx.approvalPolicy.create({
        data: {
          tenantId,
          name: body.name,
          type: body.type,
          buildingId: body.buildingId ?? null,
          version,
          isActive: true,
          currency: body.currency || 'ILS',
          minAmount: body.minAmount ?? 0,
          maxAmount: body.maxAmount ?? null,
          stepsJson: steps as any,
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
          effectiveUntil: body.effectiveUntil ? new Date(body.effectiveUntil) : null,
          supersedesId: prev?.id ?? body.supersedesId ?? null,
          createdByUserId: actorUserId,
        },
      });
    });
    return created;
  }

  async supersede(tenantId: string, actorUserId: string, id: string, body: {
    stepsJson: PolicyStep[];
    minAmount?: number;
    maxAmount?: number | null;
    effectiveFrom?: string;
  }) {
    const prev = await this.prisma.approvalPolicy.findFirst({ where: { id, tenantId } });
    if (!prev) throw new NotFoundException('policy not found');
    return this.create(tenantId, actorUserId, {
      name: prev.name,
      type: prev.type,
      buildingId: prev.buildingId,
      currency: prev.currency,
      minAmount: body.minAmount ?? prev.minAmount,
      maxAmount: body.maxAmount === undefined ? prev.maxAmount : body.maxAmount,
      stepsJson: body.stepsJson,
      effectiveFrom: body.effectiveFrom,
      supersedesId: prev.id,
    });
  }

  async list(tenantId: string, params: { type?: string; buildingId?: string; includeInactive?: boolean }) {
    const where: any = { tenantId };
    if (params.type) where.type = params.type;
    if (params.buildingId) where.buildingId = params.buildingId;
    if (!params.includeInactive) where.isActive = true;
    return this.prisma.approvalPolicy.findMany({
      where,
      orderBy: [{ type: 'asc' }, { buildingId: 'asc' }, { minAmount: 'asc' }, { version: 'desc' }],
    });
  }

  async history(tenantId: string, id: string) {
    const policy = await this.prisma.approvalPolicy.findFirst({ where: { id, tenantId } });
    if (!policy) throw new NotFoundException('policy not found');
    return this.prisma.approvalPolicy.findMany({
      where: { tenantId, name: policy.name, type: policy.type, buildingId: policy.buildingId },
      orderBy: { version: 'desc' },
    });
  }

  /** Resolve the single active policy that covers (type, buildingId, amount). */
  async resolveActive(tenantId: string, params: { type: string; buildingId?: string | null; amount: number }) {
    const candidates = await this.prisma.approvalPolicy.findMany({
      where: {
        tenantId,
        type: params.type,
        isActive: true,
        minAmount: { lte: params.amount },
        OR: [{ maxAmount: null }, { maxAmount: { gte: params.amount } }],
      },
      orderBy: [{ buildingId: 'desc' }, { minAmount: 'desc' }, { version: 'desc' }],
    });
    // Prefer building-specific policy over global
    const sameBuilding = candidates.find((c) => c.buildingId && c.buildingId === params.buildingId);
    const globalCandidate = candidates.find((c) => c.buildingId === null);
    return sameBuilding || globalCandidate || null;
  }

  async deactivate(tenantId: string, id: string) {
    const policy = await this.prisma.approvalPolicy.findFirst({ where: { id, tenantId } });
    if (!policy) throw new NotFoundException('policy not found');
    if (!policy.isActive) throw new ForbiddenException('policy is already inactive');
    return this.prisma.approvalPolicy.update({
      where: { id },
      data: { isActive: false, effectiveUntil: new Date() },
    });
  }
}
