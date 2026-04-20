// Connector interface + CSV ERP/accounting adapter.
//
// Connectors bridge Domera to external systems (ERP, accounting, BMS,
// sensor protocols). Each connector declares which CloudEvents it consumes
// (outbound ERP feeds) or produces (inbound telemetry → incidents).

export interface ConnectorContext {
  tenantId: string;
  buildingId?: string;
}

export interface Connector<InShape = any, OutShape = any> {
  readonly id: string;
  readonly kind: 'erp' | 'accounting' | 'bms' | 'bacnet' | 'opcua' | 'mqtt' | 'custom';
  readonly direction: 'inbound' | 'outbound' | 'bidirectional';
  readonly eventTypes: string[];

  /** Outbound: serialize a batch of domain events into the target format. */
  encode?(ctx: ConnectorContext, events: InShape[]): Promise<{ filename: string; mime: string; body: string }>;

  /** Inbound: parse a payload from the external system into domain-object creates. */
  decode?(ctx: ConnectorContext, raw: string): Promise<OutShape[]>;
}

// ── CSV accounting bridge ───────────────────────────────────
// Exports vendor invoices in the CSV shape consumed by SAP/Business-One/
// QuickBooks. Columns:
//   invoice_number, vendor, invoice_date, po_number, currency,
//   amount_net, amount_tax, amount_gross, match_status, approved_at.

export interface InvoiceRow {
  invoiceNumber: string;
  vendorName: string | null;
  invoiceDate: string;
  poNumber: string | null;
  currency: string;
  amount: number;
  taxAmount: number | null;
  matchStatus: string;
  approvedAt: string | null;
}

function csvEscape(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const accountingCsvConnector: Connector<InvoiceRow, never> = {
  id: 'csv.accounting.v1',
  kind: 'accounting',
  direction: 'outbound',
  eventTypes: ['domera.vendor_invoice.approved', 'domera.vendor_invoice.matched'],
  async encode(_ctx, rows) {
    const header = [
      'invoice_number', 'vendor', 'invoice_date', 'po_number', 'currency',
      'amount_net', 'amount_tax', 'amount_gross', 'match_status', 'approved_at',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      const net = r.taxAmount != null ? r.amount - r.taxAmount : r.amount;
      const tax = r.taxAmount ?? 0;
      lines.push([
        csvEscape(r.invoiceNumber),
        csvEscape(r.vendorName),
        csvEscape(r.invoiceDate.slice(0, 10)),
        csvEscape(r.poNumber),
        csvEscape(r.currency),
        csvEscape(net.toFixed(2)),
        csvEscape(tax.toFixed(2)),
        csvEscape(r.amount.toFixed(2)),
        csvEscape(r.matchStatus),
        csvEscape(r.approvedAt ? r.approvedAt.slice(0, 10) : null),
      ].join(','));
    }
    return {
      filename: `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      mime: 'text/csv; charset=utf-8',
      body: lines.join('\n') + '\n',
    };
  },
};

// Inbound: CSV from ERP with vendor master data — creates Vendor records.
export interface VendorImportRow {
  name: string;
  taxId: string | null;
  paymentTermsDays: number | null;
  contactEmail: string | null;
}

export const vendorMasterCsvConnector: Connector<never, VendorImportRow> = {
  id: 'csv.vendor_master.v1',
  kind: 'erp',
  direction: 'inbound',
  eventTypes: [],
  async decode(_ctx, raw) {
    const [headerLine, ...rest] = raw.split(/\r?\n/).filter((l) => l.length > 0);
    if (!headerLine) return [];
    const cols = headerLine.split(',').map((c) => c.trim().toLowerCase());
    const col = (row: string[], name: string): string | null => {
      const i = cols.indexOf(name);
      return i >= 0 ? (row[i] || '').trim() || null : null;
    };
    const out: VendorImportRow[] = [];
    for (const line of rest) {
      // naive split — production use a real csv parser
      const row = line.split(',');
      const name = col(row, 'name') || col(row, 'vendor') || '';
      if (!name) continue;
      out.push({
        name,
        taxId: col(row, 'tax_id') || col(row, 'vat'),
        paymentTermsDays: Number(col(row, 'payment_terms_days')) || null,
        contactEmail: col(row, 'contact_email') || col(row, 'email'),
      });
    }
    return out;
  },
};

export const registeredConnectors: Connector[] = [
  accountingCsvConnector,
  vendorMasterCsvConnector,
];

// ─── Bridge connectors for BACnet / OPC UA / MQTT ───────────────────
// Production Domera never speaks BACnet/OPC UA/MQTT directly — a separate
// gateway (Niagara, Edge OPC UA server, mqtt-bridge) normalises field-level
// packets and POSTs them here. Each connector decodes the bridge-normalised
// JSON envelope into domain objects (incidents or sensor readings) the rest
// of the platform already understands.
//
// Envelope contract (accepted by all three decoders):
//   {
//     "tenantId": "uuid",            // required
//     "buildingId": "uuid",          // required
//     "sourceId": "bridge-xyz",      // id of the gateway process
//     "points": [
//       { "ref": "ahu-1.supply_temp_f", "ts": "ISO", "value": 58.3,
//         "alarm": false, "quality": "good",
//         "bacnetId": "2001",          // bacnet
//         "opcNodeId": "ns=2;s=AHU1.T",// opcua
//         "mqttTopic": "dom/bldg/ahu", // mqtt
//         "severity": "P2",            // optional — triggers incident
//         "alarmMessage": "Freeze-stat tripped"
//       }
//     ]
//   }

export interface BridgeIngestEnvelope {
  tenantId: string;
  buildingId: string;
  sourceId: string;
  points: BridgePoint[];
}

export interface BridgePoint {
  ref: string;
  ts: string;
  value?: number | string | boolean | null;
  alarm?: boolean;
  quality?: 'good' | 'bad' | 'uncertain';
  bacnetId?: string;
  opcNodeId?: string;
  mqttTopic?: string;
  haystackRef?: string;
  severity?: 'P1' | 'P2' | 'P3' | 'P4';
  alarmMessage?: string;
}

export interface DecodedBridgeRow {
  kind: 'sensor_reading' | 'incident';
  point: BridgePoint;
}

function buildBridgeDecoder(
  id: string,
  kind: 'bacnet' | 'opcua' | 'mqtt',
  externalIdKey: keyof BridgePoint,
): Connector<never, DecodedBridgeRow> {
  return {
    id,
    kind,
    direction: 'inbound',
    eventTypes: ['domera.sensor.reading', 'domera.incident.opened'],
    async decode(_ctx, raw) {
      let env: BridgeIngestEnvelope;
      try { env = JSON.parse(raw); } catch { throw new Error(`${id}: invalid JSON envelope`); }
      if (!env || !Array.isArray(env.points)) throw new Error(`${id}: envelope missing points[]`);
      const out: DecodedBridgeRow[] = [];
      for (const p of env.points) {
        if (!p.ref) continue;
        // Confirm that the point carries the expected protocol identifier —
        // rejects mis-routed packets (e.g. an MQTT topic sent to the BACnet
        // endpoint) so the audit trail remains accurate.
        if (!p[externalIdKey]) continue;
        if (p.alarm || p.severity) {
          out.push({ kind: 'incident', point: p });
        } else {
          out.push({ kind: 'sensor_reading', point: p });
        }
      }
      return out;
    },
  };
}

export const bacnetBridgeConnector = buildBridgeDecoder('bridge.bacnet.v1', 'bacnet', 'bacnetId');
export const opcuaBridgeConnector = buildBridgeDecoder('bridge.opcua.v1', 'opcua', 'opcNodeId');
export const mqttBridgeConnector = buildBridgeDecoder('bridge.mqtt.v1', 'mqtt', 'mqttTopic');

registeredConnectors.push(bacnetBridgeConnector, opcuaBridgeConnector, mqttBridgeConnector);
