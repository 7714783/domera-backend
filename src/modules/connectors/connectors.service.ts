import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  accountingCsvConnector,
  bacnetBridgeConnector,
  InvoiceRow,
  mqttBridgeConnector,
  opcuaBridgeConnector,
  registeredConnectors,
  vendorMasterCsvConnector,
  BridgeIngestEnvelope,
  DecodedBridgeRow,
} from './connector';

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

  // ─── BACnet / OPC UA / MQTT bridge ingestion ─────────────────
  async ingestBridge(tenantId: string, connectorId: string, actorUserId: string | null, raw: string) {
    const conn = connectorId === 'bridge.bacnet.v1' ? bacnetBridgeConnector
      : connectorId === 'bridge.opcua.v1' ? opcuaBridgeConnector
      : connectorId === 'bridge.mqtt.v1' ? mqttBridgeConnector
      : null;
    if (!conn) throw new NotFoundException(`unknown bridge connector ${connectorId}`);
    if (!raw) throw new BadRequestException('empty payload');

    // Envelope tenant must match the request context — rejects mis-routed or
    // spoofed gateway packets.
    let env: BridgeIngestEnvelope;
    try { env = JSON.parse(raw); } catch { throw new BadRequestException('invalid JSON envelope'); }
    if (env.tenantId !== tenantId) {
      throw new BadRequestException('envelope tenantId mismatch');
    }
    const building = await this.prisma.building.findFirst({
      where: { id: env.buildingId, tenantId }, select: { id: true },
    });
    if (!building) throw new BadRequestException('envelope buildingId not in tenant');

    const decoded: DecodedBridgeRow[] = await conn.decode!({ tenantId, buildingId: env.buildingId }, raw);
    const incidents: string[] = [];
    const readings: Array<{ ref: string; ts: string; value: any }> = [];

    for (const row of decoded) {
      if (row.kind === 'incident') {
        const inc = await this.prisma.incident.create({
          data: {
            tenantId,
            buildingId: env.buildingId,
            title: row.point.alarmMessage || `Bridge alarm: ${row.point.ref}`,
            description: `Source: ${env.sourceId} · Ref: ${row.point.ref} · Quality: ${row.point.quality || 'n/a'}`,
            severity: row.point.severity || 'P3',
            origin: `bridge:${conn.kind}`,
            status: 'new',
            reportedBy: actorUserId,
            reportedAt: new Date(row.point.ts || Date.now()),
          },
        });
        incidents.push(inc.id);
      } else {
        readings.push({
          ref: row.point.ref,
          ts: row.point.ts,
          value: row.point.value ?? null,
        });
      }
    }
    return {
      connectorId, sourceId: env.sourceId, buildingId: env.buildingId,
      pointsReceived: env.points.length,
      incidentsCreated: incidents.length,
      incidentIds: incidents,
      readingsAccepted: readings.length,
      // Note: sensor readings are accepted but only echoed back in this
      // version; a downstream worker fans them out to SensorPoint history.
    };
  }
}
