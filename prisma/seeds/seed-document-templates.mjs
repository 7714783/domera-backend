#!/usr/bin/env node
// Seeds DocumentTemplate rows for the default tenant:
//   1) Built-in sketch forms for common Israeli statutory obligations
//      (fs_form_8, earthing_certificate, thermography_report, etc.) —
//      with ready-to-use markdown bodies.
//   2) Any file dropped into `m:/ppmit/DOC template/` is imported as a
//      printable template. The file is copied under the object-storage root
//      and a Document + DocumentTemplate pair is created. Idempotent by key.
//
// Run:
//   DATABASE_URL_MIGRATOR=postgresql://domera_migrator:...@localhost/domera_local \
//   node apps/api/prisma/seeds/seed-document-templates.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_MIGRATOR || process.env.DATABASE_URL } },
});

const TEMPLATE_DIR = process.env.DOC_TEMPLATE_DIR || 'm:/ppmit/DOC template';
const STORAGE_ROOT = process.env.OBJECT_STORAGE_ROOT || path.resolve('apps/api/.data/documents');

// ── Built-in sketch forms ─────────────────────────────────────────
const BUILT_INS = [
  {
    key: 'fs_form_8_sketch',
    name: 'SI 158 · Fire Safety Form 8 (sketch)',
    kind: 'sketch_form',
    documentTypeKey: 'fs_form_8',
    requiresPhoto: true,
    requiresDigitalSignoff: true,
    retentionYears: 7,
    description: 'Israeli Fire Safety authority form 8 — annual inspection record.',
    bodyMarkdown: `# Fire Safety Inspection — Form 8

**Building**: {{building.name}}
**Date of inspection**: __________
**Inspector (licensed)**: __________  License #: __________
**Certification expiry**: __________

## 1. Fire detection system
- [ ] Control panel healthy (no trouble / alarm / supervisory)
- [ ] Battery backup voltage within spec (__________ V, expected 24 ± 2)
- [ ] Sensitivity test passed for all addressable detectors (date: __________)
- [ ] Notes: __________

## 2. Sprinkler system
- [ ] Main valve position: OPEN / CLOSED
- [ ] Pressure gauge static reading: __________ bar
- [ ] Pressure gauge dynamic reading: __________ bar
- [ ] Inspector's test valve flow: __________ L/min

## 3. Fire pumps
- [ ] Weekly churn test performed (last: __________)
- [ ] Annual flow test scheduled/performed (date: __________)

## 4. Emergency lighting
- [ ] 90-minute duration test passed
- [ ] Batteries within replacement interval

## 5. Fire doors & compartmentation
- [ ] Self-closers functional
- [ ] Dampers exercised

## 6. Deficiencies list
| # | Location | Finding | Severity | Target fix |
|---|----------|---------|----------|------------|
| 1 |          |         |          |            |
| 2 |          |         |          |            |

## 7. Signatures
Inspector: ________________________
Building Manager: ________________________
Owner Representative: ________________________
`,
  },
  {
    key: 'earthing_certificate_sketch',
    name: 'SI 1173 · Earthing (grounding) certificate',
    kind: 'sketch_form',
    documentTypeKey: 'earthing_certificate',
    requiresPhoto: true,
    requiresDigitalSignoff: true,
    retentionYears: 7,
    description: 'Annual earthing/grounding resistance certificate per SI 1173.',
    bodyMarkdown: `# Earthing (Grounding) Certificate

**Building**: {{building.name}}
**Inspector (electrician l3)**: __________  License #: __________
**Instrument used**: __________  Calibration date: __________

## Measurements
| Point | Location | Measured Ω | Max allowed Ω | Pass |
|-------|----------|-----------|---------------|------|
| MGB   | Main earthing bar |      | 5             |      |
| P1    | Panel A |           | 10            |      |
| P2    | Panel B |           | 10            |      |

## Continuity
- [ ] Protective conductors continuous
- [ ] Bonding to water/gas piping
- [ ] Bonding to structural metal

## Signatures
Electrician: ________________________ (l3)
Building Manager: ________________________
`,
  },
  {
    key: 'thermography_report_sketch',
    name: 'Thermography report (electrical panels)',
    kind: 'sketch_form',
    documentTypeKey: 'thermography_report',
    requiresPhoto: true,
    requiresDigitalSignoff: false,
    retentionYears: 5,
    description: 'Annual thermographic survey of electrical distribution panels.',
    bodyMarkdown: `# Thermography Report — Electrical Panels

**Building**: {{building.name}}
**Surveyor**: __________  License #: __________
**Camera**: __________  Calibration date: __________
**Ambient temperature**: __________ °C
**Load at time of survey**: approx __________ % of rated

## Findings
| # | Panel | Device | ΔT vs ambient (°C) | Severity | Action |
|---|-------|--------|---------------------|----------|--------|
| 1 |       |        |                     |          |        |
| 2 |       |        |                     |          |        |

Severity scale: < 10 °C = monitor · 10–25 °C = schedule repair · > 25 °C = immediate.

## Photos
Attach thermal image + visible-light image for each finding.

## Signatures
Surveyor: ________________________
Building Manager: ________________________
`,
  },
  {
    key: 'lift_annual_inspection_sketch',
    name: 'Lift annual inspection (SI 24)',
    kind: 'sketch_form',
    documentTypeKey: 'lift_inspection_report',
    requiresPhoto: false,
    requiresDigitalSignoff: true,
    retentionYears: 7,
    description: 'Annual lift inspection certificate — Israeli standard SI 24.',
    bodyMarkdown: `# Lift Annual Inspection — SI 24

**Building**: {{building.name}}
**Shaft(s)**: __________
**Inspector (certified)**: __________  License #: __________

## Safety circuits
- [ ] Door interlocks
- [ ] Overspeed governor
- [ ] Safety gear trigger test
- [ ] Buffer inspection
- [ ] Emergency brake

## Load test
- Rated load: __________ kg
- Test load: __________ kg (125 % for certification)
- Brake slip: __________ mm

## Machine room
- [ ] Ventilation within spec
- [ ] Fire-resistant rating intact
- [ ] Tripping devices accessible

## Defects & remedial actions
| # | Finding | Target date | Status |
|---|---------|-------------|--------|
|   |         |             |        |

## Signatures
Inspector: ________________________
Building Manager: ________________________
Owner Representative: ________________________
`,
  },
  {
    key: 'ppm_generic_checklist',
    name: 'Generic PPM completion checklist',
    kind: 'sketch_form',
    documentTypeKey: null,
    requiresPhoto: false,
    requiresDigitalSignoff: false,
    retentionYears: 3,
    description: 'Fallback checklist for PPM programs without a statutory form.',
    bodyMarkdown: `# PPM Completion Record

**Program**: {{program.name}}
**Performed on**: __________
**Performed by**: __________

## Checkpoints
- [ ] Visual inspection
- [ ] Functional test
- [ ] Lubrication / cleaning (if applicable)
- [ ] Safety devices checked

## Parts & consumables used
| Item | Qty | Source |
|------|-----|--------|
|      |     |        |

## Next recommended inspection
Based on RRULE: __________

## Signatures
Performer: ________________________
Reviewer: ________________________
`,
  },
];

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function ensureBuiltInTemplate(tenantId, spec) {
  const existing = await prisma.documentTemplate.findUnique({
    where: { tenantId_key: { tenantId, key: spec.key } },
  });
  if (existing) {
    // Refresh non-destructive fields so seed is idempotent.
    return prisma.documentTemplate.update({
      where: { id: existing.id },
      data: {
        name: spec.name,
        description: spec.description,
        kind: spec.kind,
        documentTypeKey: spec.documentTypeKey,
        bodyMarkdown: spec.bodyMarkdown,
        requiresPhoto: !!spec.requiresPhoto,
        requiresDigitalSignoff: !!spec.requiresDigitalSignoff,
        retentionYears: spec.retentionYears ?? null,
        isActive: true,
      },
    });
  }
  return prisma.documentTemplate.create({
    data: {
      tenantId,
      key: spec.key,
      name: spec.name,
      description: spec.description,
      kind: spec.kind,
      documentTypeKey: spec.documentTypeKey ?? null,
      bodyMarkdown: spec.bodyMarkdown ?? null,
      requiresPhoto: !!spec.requiresPhoto,
      requiresDigitalSignoff: !!spec.requiresDigitalSignoff,
      retentionYears: spec.retentionYears ?? null,
      createdByUserId: 'seed',
    },
  });
}

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  md: 'text/markdown',
};

async function ingestPrintableFromFile(tenantId, filePath) {
  const name = path.basename(filePath);
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
  const body = fs.readFileSync(filePath);
  const sha = sha256Hex(body);

  // Slug the key from filename (lowercase, alphanum only).
  const baseName = name.replace(/\.[^/.]+$/, '');
  const key = `dt_${baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`;

  // Store the sample file under the same shape documents use.
  const storageKey = `t/${tenantId}/templates/${sha}`;
  const diskPath = path.join(STORAGE_ROOT, storageKey);
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  if (!fs.existsSync(diskPath)) fs.writeFileSync(diskPath, body);

  // Create an anchor Document (no building — tenant-wide sample).
  // We need a building for the existing Document schema, so we pick any one;
  // if there's none we skip printable ingest. (Templates can still be
  // scoped tenant-wide without a Document attachment for sketch_form kind.)
  const building = await prisma.building.findFirst({ where: { tenantId } });
  if (!building) return null;

  let doc = await prisma.document.findFirst({
    where: { tenantId, sha256: sha, title: `Template sample — ${baseName}` },
  });
  if (!doc) {
    doc = await prisma.document.create({
      data: {
        tenantId,
        buildingId: building.id,
        title: `Template sample — ${baseName}`,
        documentType: 'template_sample',
        documentTypeKey: null,
        status: 'approved',
        versionNo: 1,
        storageKey,
        sha256: sha,
        mimeType,
        sizeBytes: body.length,
        virusScanStatus: 'unscanned',
        retentionClass: 'standard',
        legalHold: false,
        createdBy: 'seed',
      },
    });
  }

  // Upsert the template.
  const existing = await prisma.documentTemplate.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });
  if (existing) {
    return prisma.documentTemplate.update({
      where: { id: existing.id },
      data: {
        name: `Printable · ${baseName}`,
        kind: 'printable',
        sampleDocumentId: doc.id,
        description: `Imported from DOC template/ on ${new Date().toISOString().slice(0, 10)}.`,
        isActive: true,
      },
    });
  }
  return prisma.documentTemplate.create({
    data: {
      tenantId,
      key,
      name: `Printable · ${baseName}`,
      kind: 'printable',
      description: `Imported from DOC template/ on ${new Date().toISOString().slice(0, 10)}.`,
      sampleDocumentId: doc.id,
      retentionYears: 5,
      createdByUserId: 'seed',
    },
  });
}

async function run() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  if (tenants.length === 0) {
    console.error('[doc-templates] no tenants found; seed a tenant first');
    process.exit(1);
  }

  const results = { builtIns: 0, imported: 0, skipped: 0 };
  for (const t of tenants) {
    for (const b of BUILT_INS) {
      await ensureBuiltInTemplate(t.id, b);
      results.builtIns += 1;
    }
    if (fs.existsSync(TEMPLATE_DIR)) {
      const files = fs.readdirSync(TEMPLATE_DIR).filter((f) => !f.startsWith('.'));
      for (const f of files) {
        const full = path.join(TEMPLATE_DIR, f);
        if (!fs.statSync(full).isFile()) continue;
        try {
          const r = await ingestPrintableFromFile(t.id, full);
          if (r) results.imported += 1;
          else results.skipped += 1;
        } catch (e) {
          console.error(`[doc-templates] skip ${f}:`, e?.message || e);
          results.skipped += 1;
        }
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        tenants: tenants.length,
        ...results,
        templateDir: TEMPLATE_DIR,
        note: 'Drop PDF/DOC/XLSX files into DOC template/ and rerun to register as printable templates.',
      },
      null,
      2,
    ),
  );
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
