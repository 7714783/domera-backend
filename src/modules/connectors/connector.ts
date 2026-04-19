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
