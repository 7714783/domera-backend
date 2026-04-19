import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { accountingCsvConnector, InvoiceRow, registeredConnectors, vendorMasterCsvConnector } from './connector';

@Injectable()
export class ConnectorsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return registeredConnectors.map((c) => ({
      id: c.id,
      kind: c.kind,
      direction: c.direction,
      eventTypes: c.eventTypes,
    }));
  }

  async exportAccounting(tenantId: string, params: { from?: string; to?: string; matchStatus?: string; approvedOnly?: boolean }) {
    const where: any = { tenantId };
    if (params.approvedOnly) where.approvalStatus = 'approved';
    if (params.matchStatus) where.matchStatus = params.matchStatus;
    if (params.from || params.to) {
      where.invoiceDate = {};
      if (params.from) where.invoiceDate.gte = new Date(params.from);
      if (params.to) where.invoiceDate.lte = new Date(params.to);
    }
    const invoices = await this.prisma.vendorInvoice.findMany({ where, orderBy: { invoiceDate: 'asc' } });
    const vendorIds = [...new Set(invoices.map((i) => i.vendorOrgId).filter(Boolean) as string[])];
    const vendors = vendorIds.length
      ? await this.prisma.organization.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true } })
      : [];
    const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
    const poIds = [...new Set(invoices.map((i) => i.purchaseOrderId))];
    const pos = poIds.length
      ? await this.prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, poNumber: true } })
      : [];
    const poNumber = new Map(pos.map((p) => [p.id, p.poNumber]));

    const rows: InvoiceRow[] = invoices.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      vendorName: i.vendorOrgId ? (vendorName.get(i.vendorOrgId) || null) : null,
      invoiceDate: i.invoiceDate.toISOString(),
      poNumber: poNumber.get(i.purchaseOrderId) || null,
      currency: i.currency,
      amount: i.amount,
      taxAmount: i.taxAmount,
      matchStatus: i.matchStatus,
      approvedAt: i.approvedAt ? i.approvedAt.toISOString() : null,
    }));

    return accountingCsvConnector.encode!({ tenantId }, rows);
  }

  async importVendorMaster(tenantId: string, actorUserId: string, raw: string) {
    if (!raw || raw.length < 5) throw new BadRequestException('empty csv');
    const decoded = await vendorMasterCsvConnector.decode!({ tenantId }, raw);
    const created: string[] = [];
    const updated: string[] = [];
    for (const v of decoded) {
      const existing = await this.prisma.vendor.findFirst({ where: { tenantId, name: v.name } });
      const contactInfo = {
        taxId: v.taxId, paymentTermsDays: v.paymentTermsDays, contactEmail: v.contactEmail,
      };
      if (existing) {
        await this.prisma.vendor.update({
          where: { id: existing.id },
          data: { contactInfo: contactInfo as any },
        });
        updated.push(existing.id);
      } else {
        const c = await this.prisma.vendor.create({
          data: { tenantId, name: v.name, contactInfo: contactInfo as any },
        });
        created.push(c.id);
      }
    }
    return { createdVendors: created.length, updatedVendors: updated.length, totalRows: decoded.length };
  }
}
