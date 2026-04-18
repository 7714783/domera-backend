import * as XLSX from 'xlsx';

export type XlsxCell = string | number | boolean | null | undefined;
export type XlsxRow = Record<string, XlsxCell>;

export interface RegulatorMapped {
  domain: string | null;
  name: string;
  authorizedPerformer: string | null;
  requiredDocumentation: string | null;
  frequencyMonths: number | null;
  recurrenceRule: string;
  bases: Array<{ type: string; reference: string | null }>;
  applicability: Array<{ attr: string; op: string; value: number | string }>;
  requiredCertificationKey: string | null;
  requiredDocumentTypeKey: string | null;
}

export interface PpmMapped {
  site: string | null;
  templateName: string;
  serviceKind: 'hard' | 'soft';
  recurrenceRule: string;
  frequencyLabel: string | null;
  statutory: boolean;
  months: string[];
}

export interface StPmMapped {
  site: string;
  taskName: string;
  lastCompletedAt: string | null;
  nextDueAt: string | null;
  domain: string | null;
}

export interface SheetPreview<T> {
  rows: Array<{
    rowNumber: number;
    raw: XlsxRow;
    mapped: T | null;
    errors: string[];
    warnings: string[];
  }>;
  summary: { total: number; ok: number; warnings: number; errors: number };
}

export interface FileCatalog {
  certifications: Array<{ key: string; name: string }>;
  documentTypes: Array<{ key: string; name: string }>;
}

function toRows(ws: XLSX.WorkSheet): XlsxRow[] {
  return XLSX.utils.sheet_to_json<XlsxRow>(ws, { defval: null, raw: true });
}

function textOrNull(v: XlsxCell): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function pick(row: XlsxRow, ...keys: string[]): XlsxCell {
  for (const k of keys) {
    if (k in row && row[k] !== null && row[k] !== undefined && row[k] !== '') return row[k];
  }
  return null;
}

function classifyDomain(hebrew: string | null): string | null {
  if (!hebrew) return null;
  const h = hebrew.replace(/\s+/g, ' ').trim();
  const map: Record<string, string> = {
    'אנרגיה': 'energy',
    'בדיקות מהנדס': 'engineer_inspections',
    'גז / דלק': 'gas_fuel',
    'גילוי וכיבוי אש': 'fire_life_safety',
    'חשמל': 'electrical',
    'מים ושפכים': 'water_plumbing',
    'מעליות': 'vertical_transport',
    'ציוד הרמה ומכלים בלחץ': 'lifting_pressure',
    'שונות': 'misc_hse',
  };
  return map[h] || null;
}

function frequencyToRrule(freqMonths: number | null): string {
  if (!freqMonths || !isFinite(freqMonths) || freqMonths <= 0) return 'FREQ=YEARLY;INTERVAL=1';
  const m = Math.round(freqMonths);
  if (m < 12) return `FREQ=MONTHLY;INTERVAL=${m}`;
  if (m % 12 === 0) return `FREQ=YEARLY;INTERVAL=${m / 12}`;
  return `FREQ=MONTHLY;INTERVAL=${m}`;
}

function parseApplicability(siteType: string | null, name: string): Array<{ attr: string; op: string; value: number | string }> {
  const rules: Array<{ attr: string; op: string; value: number | string }> = [];
  if (siteType && /בניין בעל 10 קומות ויותר/.test(siteType)) {
    rules.push({ attr: 'building.floors_count', op: '>=', value: 10 });
  }
  if (siteType && /בניין מתחת 10 קומות/.test(siteType)) {
    rules.push({ attr: 'building.floors_count', op: '<', value: 10 });
  }
  if (/מעל 100 טון קירור/.test(name)) {
    rules.push({ attr: 'asset.cooling_tons', op: '>', value: 100 });
  }
  const kwhMatch = name.match(/(\d+(?:[.,]\d+)?)\s*מליון.*?קו.טש/);
  if (kwhMatch) {
    const v = Number(kwhMatch[1].replace(',', '.')) * 1_000_000;
    rules.push({ attr: 'building.annual_kwh', op: '>', value: v });
  }
  return rules;
}

function matchCert(performer: string | null, catalog: FileCatalog): { key: string | null; warn: string | null } {
  if (!performer) return { key: null, warn: null };
  const p = performer.replace(/\s+/g, ' ').trim();
  const rules: Array<[RegExp, string]> = [
    [/מתח גבוה|מתח-גבוה/, 'electrician_hv'],
    [/חשמלאי בודק/, 'electrician_l3'],
    [/מעבדה מוסמכת|מעבדה מוכרת/, 'accredited_lab'],
    [/בודק מוסמך.*מעליות|תחום מעליות/, 'licensed_lift_inspector'],
    [/דרגנוע/, 'licensed_escalator_inspector'],
    [/מחטא/, 'certified_disinfector'],
    [/כבאות|מפקח כבאות|בטיחות אש/, 'fire_safety_inspector'],
    [/סוקר אנרגיה|בוחן נצילות/, 'licensed_energy_surveyor'],
    [/מהנדס מכונות/, 'registered_mechanical_engineer'],
    [/מהנדס אזרחי|מהנדס רשום/, 'registered_civil_engineer'],
    [/גפ["״]?ם|גפ"מ|מתקין גפ/, 'authorized_lpg_installer'],
    [/קולטי אוויר|קולטי קיטור|דודי קיטור|מיכל לחץ/, 'pressure_vessel_inspector'],
    [/אביזרי הרמה|מכונות הרמה/, 'lifting_gear_inspector'],
    [/ברקים/, 'lightning_protection_inspector'],
    [/טרמוגרפיה/, 'thermography_surveyor'],
  ];
  for (const [re, key] of rules) {
    if (re.test(p) && catalog.certifications.some((c) => c.key === key)) return { key, warn: null };
  }
  return { key: null, warn: `unmapped_certification: ${p}` };
}

function matchDocType(doc: string | null, catalog: FileCatalog): { key: string | null; warn: string | null } {
  if (!doc) return { key: null, warn: null };
  const d = doc.replace(/\s+/g, ' ').trim();
  const fsNum = d.match(/טופס\s*(?:מספר\s*)?(\d+[אב]?)/);
  if (fsNum && /כבאות/.test(d)) {
    const n = fsNum[1].replace('א', 'a').replace('ב', 'b');
    const key = `fs_form_${n}`;
    if (catalog.documentTypes.some((x) => x.key === key)) return { key, warn: null };
  }
  if (/ת["״]?י\s*158.*ד\s*4/.test(d)) return { key: 'ti_158_4_d4', warn: null };
  if (/ת["״]?י\s*158.*ד\s*5/.test(d)) return { key: 'ti_158_4_d5', warn: null };
  if (/טרמוגרפי/.test(d)) return { key: 'thermography_report', warn: null };
  if (/הארק/.test(d)) return { key: 'earthing_certificate', warn: null };
  if (/מעבדה/.test(d)) return { key: 'lab_analysis', warn: null };
  if (/תסקיר/.test(d)) return { key: 'inspector_report', warn: null };
  if (/סקר אנרגיה|דיווח צריכת אנרגיה/.test(d)) return { key: 'energy_survey_report', warn: null };
  if (/הסכם שירות/.test(d)) return { key: 'service_contract', warn: null };
  if (/אישור מהנדס/.test(d)) return { key: 'engineer_approval', warn: null };
  if (/נוהל חירום|תצהיר עדכון/.test(d)) return { key: 'emergency_plan_update', warn: null };
  if (/טופס פנימי/.test(d)) return { key: 'internal_form', warn: null };
  return { key: null, warn: `unmapped_document_type: ${d}` };
}

export function parseRegulator(ws: XLSX.WorkSheet, catalog: FileCatalog): SheetPreview<RegulatorMapped> {
  const rows = toRows(ws);
  const out: SheetPreview<RegulatorMapped>['rows'] = [];
  let n = 0;

  for (const raw of rows) {
    n += 1;
    const errors: string[] = [];
    const warnings: string[] = [];
    const domainRaw = textOrNull(pick(raw, 'תחום'));
    const typeRaw = textOrNull(pick(raw, 'סוג בדיקה'));
    const siteType = textOrNull(pick(raw, 'סוג אתר'));
    const performer = textOrNull(pick(raw, 'מורשה לביצוע'));
    const doc = textOrNull(pick(raw, 'תיעוד נדרש'));
    const statutory = textOrNull(pick(raw, 'דרישת חוק ', 'דרישת חוק'));
    const standard = textOrNull(pick(raw, 'תקן 1525'));
    const internal = textOrNull(pick(raw, 'דרישה פנימית ', 'דרישה פנימית'));
    const freqRaw = pick(raw, 'תדירות (חודשים)');
    const freqMonths = typeof freqRaw === 'number' ? freqRaw : freqRaw ? Number(String(freqRaw)) : null;

    if (!typeRaw) {
      out.push({ rowNumber: n, raw, mapped: null, errors: [], warnings: ['empty_row'] });
      continue;
    }

    const bases: Array<{ type: string; reference: string | null }> = [];
    if (statutory && statutory !== 'NA') bases.push({ type: 'statutory', reference: statutory === 'X' ? null : statutory });
    if (standard && standard !== 'NA') bases.push({ type: 'standard', reference: standard === 'X' ? 'SI 1525' : standard });
    if (internal && internal !== 'NA') bases.push({ type: 'internal', reference: internal === 'X' ? null : internal });
    if (bases.length === 0) bases.push({ type: 'recommended_best_practice', reference: null });

    const certMatch = matchCert(performer, catalog);
    if (certMatch.warn) warnings.push(certMatch.warn);
    const docMatch = matchDocType(doc, catalog);
    if (docMatch.warn) warnings.push(docMatch.warn);

    const applicability = parseApplicability(siteType, typeRaw);

    const mapped: RegulatorMapped = {
      domain: classifyDomain(domainRaw) || domainRaw || null,
      name: typeRaw,
      authorizedPerformer: performer,
      requiredDocumentation: doc,
      frequencyMonths: Number.isFinite(freqMonths as number) ? (freqMonths as number) : null,
      recurrenceRule: frequencyToRrule(Number.isFinite(freqMonths as number) ? (freqMonths as number) : null),
      bases,
      applicability,
      requiredCertificationKey: certMatch.key,
      requiredDocumentTypeKey: docMatch.key,
    };

    out.push({ rowNumber: n, raw, mapped, errors, warnings });
  }

  const summary = {
    total: out.filter((r) => r.mapped).length,
    ok: out.filter((r) => r.mapped && r.errors.length === 0 && r.warnings.length === 0).length,
    warnings: out.filter((r) => r.mapped && r.warnings.length > 0 && r.errors.length === 0).length,
    errors: out.filter((r) => r.errors.length > 0).length,
  };
  return { rows: out, summary };
}

export function parsePpm(ws: XLSX.WorkSheet): SheetPreview<PpmMapped> {
  const rows = toRows(ws);
  const out: SheetPreview<PpmMapped>['rows'] = [];
  let n = 0;
  const monthKeys = ['Jan ', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const freqMap: Record<string, string> = {
    monthly: 'FREQ=MONTHLY;INTERVAL=1',
    annual: 'FREQ=YEARLY;INTERVAL=1',
    'semi-annual': 'FREQ=MONTHLY;INTERVAL=6',
    'bi-annual': 'FREQ=MONTHLY;INTERVAL=6',
    'six-monthly': 'FREQ=MONTHLY;INTERVAL=6',
    quarterly: 'FREQ=MONTHLY;INTERVAL=3',
    '3 months': 'FREQ=MONTHLY;INTERVAL=3',
    '6 months': 'FREQ=MONTHLY;INTERVAL=6',
    '2 weeks': 'FREQ=WEEKLY;INTERVAL=2',
    '5 years': 'FREQ=YEARLY;INTERVAL=5',
  };

  for (const raw of rows) {
    n += 1;
    const site = textOrNull(pick(raw, 'אתר / Site'));
    const kind = textOrNull(pick(raw, 'סוג / Type'));
    const desc = textOrNull(pick(raw, 'תיאור הבדיקה / המערכת\nInspection Description / Systems', 'תיאור טכני / מערכת\nTechnical Description / Systems'));
    const freq = textOrNull(pick(raw, 'תדירות\nFreq.'));
    const statutory = textOrNull(pick(raw, 'סטטוטורי Statutory'));
    if (!desc) {
      out.push({ rowNumber: n, raw, mapped: null, errors: [], warnings: ['empty_row'] });
      continue;
    }
    const months = monthKeys.filter((k) => {
      const v = pick(raw, k);
      return v !== null && v !== undefined && String(v).trim().length > 0;
    }).map((k) => k.trim());
    const rrule = freq ? (freqMap[freq.toLowerCase()] || 'FREQ=YEARLY;INTERVAL=1') : 'FREQ=YEARLY;INTERVAL=1';
    const mapped: PpmMapped = {
      site,
      templateName: desc,
      serviceKind: (kind || '').toLowerCase().includes('soft') ? 'soft' : 'hard',
      recurrenceRule: rrule,
      frequencyLabel: freq,
      statutory: (statutory || '').toUpperCase() === 'Y',
      months,
    };
    out.push({ rowNumber: n, raw, mapped, errors: [], warnings: [] });
  }
  const summary = {
    total: out.filter((r) => r.mapped).length,
    ok: out.filter((r) => r.mapped && r.errors.length === 0).length,
    warnings: out.filter((r) => r.mapped && r.warnings.length > 0).length,
    errors: out.filter((r) => r.errors.length > 0).length,
  };
  return { rows: out, summary };
}

function excelDateToIso(v: XlsxCell): string | null {
  if (v === null || v === undefined || v === '' || v === 'NA') return null;
  if (typeof v === 'number' && isFinite(v) && v > 20000 && v < 80000) {
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

export function parseStPm(ws: XLSX.WorkSheet): SheetPreview<StPmMapped> {
  const rows = toRows(ws);
  const out: SheetPreview<StPmMapped>['rows'] = [];
  let n = 0;

  const siteKeys = [
    { site: 'NTN 01', last: 'NTN 01', next: 'NTN 012' },
    { site: 'NTN 02', last: 'NTN 02', next: 'NTN 022' },
    { site: 'NTN 03', last: 'NTN 03', next: 'NTN 032' },
  ];

  for (const raw of rows) {
    n += 1;
    const typeRaw = textOrNull(pick(raw, 'סוג בדיקה'));
    const domainRaw = textOrNull(pick(raw, 'תחום'));
    if (!typeRaw) {
      out.push({ rowNumber: n, raw, mapped: null, errors: [], warnings: ['empty_row'] });
      continue;
    }
    let mapped: StPmMapped | null = null;
    for (const s of siteKeys) {
      const last = excelDateToIso(pick(raw, s.last));
      const next = excelDateToIso(pick(raw, s.next));
      if (last || next) {
        mapped = { site: s.site, taskName: typeRaw, lastCompletedAt: last, nextDueAt: next, domain: classifyDomain(domainRaw) };
        break;
      }
    }
    if (!mapped) {
      mapped = { site: 'NTN 01', taskName: typeRaw, lastCompletedAt: null, nextDueAt: null, domain: classifyDomain(domainRaw) };
    }
    out.push({ rowNumber: n, raw, mapped, errors: [], warnings: [] });
  }
  const summary = {
    total: out.filter((r) => r.mapped).length,
    ok: out.filter((r) => r.mapped && r.errors.length === 0).length,
    warnings: out.filter((r) => r.mapped && r.warnings.length > 0).length,
    errors: out.filter((r) => r.errors.length > 0).length,
  };
  return { rows: out, summary };
}

export function parseWorkbook(buf: Buffer, catalog: FileCatalog) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const regulator = wb.Sheets['Regulator'] ? parseRegulator(wb.Sheets['Regulator'], catalog) : null;
  const ppm = wb.Sheets['PPM'] ? parsePpm(wb.Sheets['PPM']) : null;
  const stpm = wb.Sheets['ST_PM'] ? parseStPm(wb.Sheets['ST_PM']) : null;
  return { regulator, ppm, stpm };
}
