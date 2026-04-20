import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BuildingsService } from '../buildings/buildings.service';

const ALLOWED_ALLOCATION_TARGETS = ['unit', 'parking_spot', 'storage_unit'];
const ALLOWED_ESCALATION_TYPES = ['cpi', 'fixed_pct', 'stepped'];

type EscalationPolicy = {
  type: 'cpi' | 'fixed_pct' | 'stepped';
  ratePct?: number;
  indexBase?: string;
  schedule?: Array<{ atMonth: number; ratePct: number }>;
};

function validateEscalation(p: any): EscalationPolicy | null {
  if (!p) return null;
  if (typeof p !== 'object') throw new BadRequestException('escalationPolicy must be an object');
  if (!ALLOWED_ESCALATION_TYPES.includes(p.type)) {
    throw new BadRequestException(`escalationPolicy.type must be one of ${ALLOWED_ESCALATION_TYPES.join(', ')}`);
  }
  if (p.type === 'fixed_pct' && typeof p.ratePct !== 'number') {
    throw new BadRequestException('fixed_pct escalation requires ratePct');
  }
  if (p.type === 'cpi' && !p.indexBase) {
    throw new BadRequestException('cpi escalation requires indexBase');
  }
  if (p.type === 'stepped' && (!Array.isArray(p.schedule) || !p.schedule.length)) {
    throw new BadRequestException('stepped escalation requires non-empty schedule');
  }
  return p as EscalationPolicy;
}

@Injectable()
export class LeasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly buildings: BuildingsService,
  ) {}

  // ─── Contracts ────────────────────────────────────────────────
  async setEscalationPolicy(tenantId: string, contractId: string, policy: any) {
    const validated = validateEscalation(policy);
    const c = await this.prisma.buildingContract.findFirst({ where: { id: contractId, tenantId } });
    if (!c) throw new NotFoundException('contract not found');
    return this.prisma.buildingContract.update({
      where: { id: contractId },
      data: { escalationPolicy: validated as any },
    });
  }

  async setInsuranceDocument(tenantId: string, contractId: string, documentId: string | null) {
    const c = await this.prisma.buildingContract.findFirst({ where: { id: contractId, tenantId } });
    if (!c) throw new NotFoundException('contract not found');
    if (documentId) {
      const d = await this.prisma.document.findFirst({ where: { id: documentId, tenantId } });
      if (!d) throw new BadRequestException('insurance document not found');
    }
    return this.prisma.buildingContract.update({
      where: { id: contractId },
      data: { insuranceDocumentId: documentId },
    });
  }

  // ─── Allocations ──────────────────────────────────────────────
  async addAllocation(tenantId: string, contractId: string, body: {
    targetType: string; targetId: string;
    monthlyAmount?: number; share?: number; currency?: string; notes?: string;
  }) {
    if (!ALLOWED_ALLOCATION_TARGETS.includes(body.targetType)) {
      throw new BadRequestException(`targetType must be one of ${ALLOWED_ALLOCATION_TARGETS.join(', ')}`);
    }
    const contract = await this.prisma.buildingContract.findFirst({ where: { id: contractId, tenantId } });
    if (!contract) throw new NotFoundException('contract not found');
    // Validate target exists in this building
    if (body.targetType === 'unit') {
      const u = await this.prisma.buildingUnit.findFirst({ where: { id: body.targetId, buildingId: contract.buildingId } });
      if (!u) throw new BadRequestException('unit not found in this building');
    } else if (body.targetType === 'parking_spot') {
      const p = await this.prisma.parkingSpot.findFirst({ where: { id: body.targetId, buildingId: contract.buildingId } });
      if (!p) throw new BadRequestException('parking spot not found in this building');
    } else if (body.targetType === 'storage_unit') {
      const s = await this.prisma.storageUnit.findFirst({ where: { id: body.targetId, buildingId: contract.buildingId } });
      if (!s) throw new BadRequestException('storage unit not found in this building');
    }
    const share = typeof body.share === 'number' ? Math.max(0, Math.min(1, body.share)) : 1;
    const created = await this.prisma.leaseAllocation.create({
      data: {
        tenantId, contractId,
        targetType: body.targetType, targetId: body.targetId,
        share, monthlyAmount: body.monthlyAmount ?? 0,
        currency: body.currency || contract.currency || 'ILS',
        notes: body.notes || null,
      },
    });
    // Flip isLeased flag on parking/storage for visibility (delegated to building-core).
    if (body.targetType === 'parking_spot' || body.targetType === 'storage_unit') {
      await this.buildings.setLeasedFlag(tenantId, body.targetType as any, body.targetId, true);
    }
    return created;
  }

  async removeAllocation(tenantId: string, allocationId: string) {
    const a = await this.prisma.leaseAllocation.findFirst({ where: { id: allocationId, tenantId } });
    if (!a) throw new NotFoundException('allocation not found');
    await this.prisma.leaseAllocation.delete({ where: { id: allocationId } });
    // Recompute isLeased flag — clear if no more active allocations point at the same target
    if (a.targetType === 'parking_spot' || a.targetType === 'storage_unit') {
      const remaining = await this.prisma.leaseAllocation.count({
        where: { tenantId, targetType: a.targetType, targetId: a.targetId },
      });
      if (remaining === 0) {
        await this.buildings.setLeasedFlag(tenantId, a.targetType as any, a.targetId, false);
      }
    }
    return { deleted: true };
  }

  async listAllocations(tenantId: string, contractId: string) {
    const c = await this.prisma.buildingContract.findFirst({ where: { id: contractId, tenantId } });
    if (!c) throw new NotFoundException('contract not found');
    const items = await this.prisma.leaseAllocation.findMany({
      where: { tenantId, contractId },
      orderBy: { createdAt: 'asc' },
    });
    const totalMonthly = items.reduce((sum, i) => sum + (i.monthlyAmount * i.share), 0);
    return { contractId, items, totalMonthly };
  }

  // ─── Expiring documents (insurance / KYC / license) ───────────
  async expiringDocuments(tenantId: string, params: { withinDays?: number; documentTypeKey?: string }) {
    const days = Math.max(1, Math.min(365, params.withinDays ?? 60));
    const cutoff = new Date(Date.now() + days * 86400000);
    const where: any = {
      tenantId,
      expiresAt: { not: null, lte: cutoff },
    };
    if (params.documentTypeKey) where.documentTypeKey = params.documentTypeKey;
    const items = await this.prisma.document.findMany({
      where,
      orderBy: { expiresAt: 'asc' },
      select: {
        id: true, title: true, documentType: true, documentTypeKey: true,
        buildingId: true, expiresAt: true, expiryAlertedAt: true, ownerOrgId: true,
        legalHold: true,
      },
      take: 200,
    });
    const now = Date.now();
    return {
      withinDays: days,
      total: items.length,
      items: items.map((d) => ({
        ...d,
        daysUntilExpiry: d.expiresAt ? Math.round((d.expiresAt.getTime() - now) / 86400000) : null,
        expired: d.expiresAt ? d.expiresAt.getTime() < now : false,
      })),
    };
  }

  async setDocumentExpiry(tenantId: string, documentId: string, expiresAt: string | null) {
    const d = await this.prisma.document.findFirst({ where: { id: documentId, tenantId } });
    if (!d) throw new NotFoundException('document not found');
    return this.prisma.document.update({
      where: { id: documentId },
      data: { expiresAt: expiresAt ? new Date(expiresAt) : null, expiryAlertedAt: null },
    });
  }
}
