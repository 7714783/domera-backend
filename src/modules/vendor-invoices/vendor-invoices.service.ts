import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const TOLERANCE_PCT = 0.02;

@Injectable()
export class VendorInvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, actorUserId: string, body: {
    buildingId: string; purchaseOrderId: string; vendorOrgId?: string;
    invoiceNumber: string; invoiceDate: string; amount: number; currency?: string;
    taxAmount?: number; documentId?: string;
  }) {
    if (!body.buildingId || !body.purchaseOrderId || !body.invoiceNumber || !body.invoiceDate || !body.amount) {
      throw new BadRequestException('buildingId, purchaseOrderId, invoiceNumber, invoiceDate, amount required');
    }
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: body.purchaseOrderId, tenantId, buildingId: body.buildingId },
    });
    if (!po) throw new NotFoundException('purchase order not found in this building');
    return this.prisma.vendorInvoice.create({
      data: {
        tenantId,
        buildingId: body.buildingId,
        purchaseOrderId: body.purchaseOrderId,
        vendorOrgId: body.vendorOrgId || po.vendorOrgId || null,
        invoiceNumber: body.invoiceNumber,
        invoiceDate: new Date(body.invoiceDate),
        amount: body.amount,
        currency: body.currency || po.currency,
        taxAmount: body.taxAmount ?? null,
        documentId: body.documentId || null,
      },
    });
  }

  async match(tenantId: string, actorUserId: string, id: string) {
    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id, tenantId } });
    if (!invoice) throw new NotFoundException('invoice not found');
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id: invoice.purchaseOrderId } });
    if (!po) {
      return this.updateMatch(id, { matchStatus: 'no_po', varianceNotes: 'PO missing' });
    }
    // Completion records per workOrder associated with this PO
    const completions = po.workOrderId
      ? await this.prisma.completionRecord.findMany({ where: { workOrderId: po.workOrderId } })
      : [];
    const completionTotal = completions.reduce((sum, c) => sum + (c.labourCost || 0) + (c.materialsCost || 0), 0);

    if (completions.length === 0) {
      return this.updateMatch(id, {
        matchStatus: 'no_completion',
        matchedPoAmount: po.amount,
        matchedCompletionAmount: 0,
        matchedByUserId: actorUserId,
        matchedAt: new Date(),
      });
    }

    const poDelta = Math.abs(invoice.amount - po.amount) / Math.max(po.amount, 1);
    const completionDelta = Math.abs(invoice.amount - completionTotal) / Math.max(completionTotal, 1);
    let matchStatus: string;
    let varianceNotes: string | null = null;

    if (poDelta <= TOLERANCE_PCT && completionDelta <= TOLERANCE_PCT) {
      matchStatus = 'matched';
    } else if (invoice.amount > po.amount * (1 + TOLERANCE_PCT)) {
      matchStatus = 'over_amount';
      varianceNotes = `invoice ${invoice.amount} > PO ${po.amount} by ${(poDelta * 100).toFixed(1)}%`;
    } else if (invoice.amount < po.amount * (1 - TOLERANCE_PCT)) {
      matchStatus = 'under_amount';
      varianceNotes = `invoice ${invoice.amount} < PO ${po.amount} by ${(poDelta * 100).toFixed(1)}%`;
    } else if (completionDelta > TOLERANCE_PCT) {
      matchStatus = 'price_mismatch';
      varianceNotes = `invoice vs completion cost variance ${(completionDelta * 100).toFixed(1)}%`;
    } else {
      matchStatus = 'matched';
    }

    return this.updateMatch(id, {
      matchStatus,
      matchedPoAmount: po.amount,
      matchedCompletionAmount: completionTotal,
      matchedByUserId: actorUserId,
      matchedAt: new Date(),
      varianceNotes,
    });
  }

  private updateMatch(id: string, data: any) {
    return this.prisma.vendorInvoice.update({ where: { id }, data });
  }

  async approve(tenantId: string, actorUserId: string, id: string) {
    const invoice = await this.prisma.vendorInvoice.findFirst({ where: { id, tenantId } });
    if (!invoice) throw new NotFoundException('invoice not found');
    if (invoice.approvalStatus === 'approved') return invoice;
    if (invoice.matchStatus === 'unmatched') {
      throw new BadRequestException('run /match before approval');
    }
    if (['over_amount', 'no_po', 'price_mismatch'].includes(invoice.matchStatus)) {
      throw new ForbiddenException(`cannot auto-approve with matchStatus=${invoice.matchStatus}; requires manual override`);
    }
    if (invoice.matchedByUserId === actorUserId) {
      throw new ForbiddenException('SoD: matcher and approver must differ');
    }
    return this.prisma.vendorInvoice.update({
      where: { id },
      data: { approvalStatus: 'approved', approvedByUserId: actorUserId, approvedAt: new Date() },
    });
  }

  async list(tenantId: string, buildingId?: string, matchStatus?: string) {
    const where: any = { tenantId };
    if (buildingId) where.buildingId = buildingId;
    if (matchStatus) where.matchStatus = matchStatus;
    return this.prisma.vendorInvoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
