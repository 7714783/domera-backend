import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseWorkbook } from './xlsx.mapper';

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadCatalog() {
    const [certifications, documentTypes] = await Promise.all([
      this.prisma.certification.findMany({ select: { key: true, name: true } }),
      this.prisma.documentType.findMany({ select: { key: true, name: true } }),
    ]);
    return { certifications, documentTypes };
  }

  async preview(tenantId: string, actorUserId: string, filename: string, buf: Buffer) {
    const catalog = await this.loadCatalog();
    const parsed = parseWorkbook(buf, catalog);

    const unmappedCerts = new Set<string>();
    const unmappedDocs = new Set<string>();
    const regulatorRows = parsed.regulator?.rows || [];
    for (const r of regulatorRows) {
      for (const w of r.warnings) {
        if (w.startsWith('unmapped_certification:')) unmappedCerts.add(w.slice('unmapped_certification:'.length).trim());
        if (w.startsWith('unmapped_document_type:')) unmappedDocs.add(w.slice('unmapped_document_type:'.length).trim());
      }
    }

    const summary = {
      filename,
      regulator: parsed.regulator?.summary,
      ppm: parsed.ppm?.summary,
      stpm: parsed.stpm?.summary,
      unmapped_certifications: [...unmappedCerts],
      unmapped_document_types: [...unmappedDocs],
    };

    const job = await this.prisma.importJob.create({
      data: {
        tenantId,
        kind: 'ppm_xlsx_regulator',
        sourceKey: `memory://${filename}`,
        status: summary.regulator && summary.regulator.errors > 0 ? 'preview_ready' : 'preview_ready',
        summary,
        createdBy: actorUserId,
      },
    });

    const rowsToInsert: Array<{ importJobId: string; sheetName: string; rowNumber: number; rawJson: any; mappedJson: any; validationErrors: any; status: string }> = [];
    for (const r of regulatorRows) {
      rowsToInsert.push({
        importJobId: job.id,
        sheetName: 'Regulator',
        rowNumber: r.rowNumber,
        rawJson: r.raw as any,
        mappedJson: r.mapped as any,
        validationErrors: { errors: r.errors, warnings: r.warnings } as any,
        status: r.errors.length > 0 ? 'error' : r.warnings.length > 0 ? 'warning' : r.mapped ? 'ok' : 'skipped',
      });
    }
    for (const r of parsed.ppm?.rows || []) {
      rowsToInsert.push({
        importJobId: job.id,
        sheetName: 'PPM',
        rowNumber: r.rowNumber,
        rawJson: r.raw as any,
        mappedJson: r.mapped as any,
        validationErrors: { errors: r.errors, warnings: r.warnings } as any,
        status: r.errors.length > 0 ? 'error' : r.mapped ? 'ok' : 'skipped',
      });
    }
    for (const r of parsed.stpm?.rows || []) {
      rowsToInsert.push({
        importJobId: job.id,
        sheetName: 'ST_PM',
        rowNumber: r.rowNumber,
        rawJson: r.raw as any,
        mappedJson: r.mapped as any,
        validationErrors: { errors: r.errors, warnings: r.warnings } as any,
        status: r.errors.length > 0 ? 'error' : r.mapped ? 'ok' : 'skipped',
      });
    }

    if (rowsToInsert.length) {
      await this.prisma.importJobRow.createMany({ data: rowsToInsert });
    }
    return { importJobId: job.id, summary };
  }

  async getJob(id: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id }, include: { rows: { take: 500, orderBy: { rowNumber: 'asc' } } } });
    if (!job) throw new NotFoundException('import job not found');
    return job;
  }

  async commit(tenantId: string, id: string, occurredAt?: string | Date) {
    const job = await this.prisma.importJob.findUnique({ where: { id }, include: { rows: true } });
    if (!job) throw new NotFoundException('import job not found');
    if (job.status === 'committed') throw new BadRequestException('already committed');
    if (job.status === 'rolled_back') throw new BadRequestException('job rolled back; cannot re-commit');
    const summary = (job.summary || {}) as any;
    if (summary.regulator && summary.regulator.errors > 0) {
      throw new BadRequestException(`preview contains ${summary.regulator.errors} errors; fix source file`);
    }

    const templateIds: string[] = [];
    const basisIds: string[] = [];
    const ruleIds: string[] = [];
    let createdTemplates = 0;
    let createdBases = 0;
    let createdRules = 0;

    for (const row of job.rows) {
      if (row.sheetName !== 'Regulator') continue;
      if (row.status === 'skipped') continue;
      const mapped = row.mappedJson as any;
      if (!mapped || !mapped.name) continue;

      const seedKey = `import:${job.id}:${row.rowNumber}`;
      const template = await this.prisma.obligationTemplate.upsert({
        where: { seedKey },
        create: {
          tenantId,
          name: mapped.name,
          basisType: mapped.bases?.[0]?.type || 'recommended_best_practice',
          recurrenceRule: mapped.recurrenceRule || 'FREQ=YEARLY;INTERVAL=1',
          requiresEvidence: true,
          requiredCertificationKey: mapped.requiredCertificationKey || null,
          requiredDocumentTypeKey: mapped.requiredDocumentTypeKey || null,
          domain: mapped.domain || null,
          sourceRow: row.rowNumber,
          seedKey,
          createdBy: `import:${job.id}`,
        },
        update: {
          name: mapped.name,
          domain: mapped.domain || null,
          recurrenceRule: mapped.recurrenceRule || 'FREQ=YEARLY;INTERVAL=1',
          requiredCertificationKey: mapped.requiredCertificationKey || null,
          requiredDocumentTypeKey: mapped.requiredDocumentTypeKey || null,
          basisType: mapped.bases?.[0]?.type || 'recommended_best_practice',
        },
      });
      templateIds.push(template.id);
      createdTemplates += 1;

      await this.prisma.obligationBasis.deleteMany({ where: { obligationTemplateId: template.id } });
      for (const b of mapped.bases || []) {
        const basis = await this.prisma.obligationBasis.create({
          data: { obligationTemplateId: template.id, type: b.type, referenceCode: b.reference || null },
        });
        basisIds.push(basis.id);
        createdBases += 1;
      }

      await this.prisma.applicabilityRule.deleteMany({ where: { obligationTemplateId: template.id } });
      for (const a of mapped.applicability || []) {
        const rule = await this.prisma.applicabilityRule.create({
          data: { obligationTemplateId: template.id, predicate: a },
        });
        ruleIds.push(rule.id);
        createdRules += 1;
      }
    }

    const now = new Date();
    const occurred = occurredAt ? new Date(occurredAt) : null;
    const updated = await this.prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: 'committed',
        committedAt: now,
        occurredAt: occurred,
        finishedAt: now,
        createdEntities: { obligationTemplate: templateIds, obligationBasis: basisIds, applicabilityRule: ruleIds } as any,
        summary: { ...(job.summary as any), commit: { createdTemplates, createdBases, createdRules } } as any,
      },
    });
    return {
      ok: true,
      importJobId: updated.id,
      createdTemplates, createdBases, createdRules,
      recordedAt: updated.createdAt,
      committedAt: updated.committedAt,
      occurredAt: updated.occurredAt,
    };
  }

  async rollback(tenantId: string, id: string, reason?: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('import job not found');
    if (job.tenantId !== tenantId) throw new NotFoundException('import job not found');
    if (job.status !== 'committed') throw new BadRequestException(`cannot rollback job in status "${job.status}"`);

    const created = (job.createdEntities || {}) as Record<string, string[]>;
    const templateIds = created.obligationTemplate || [];
    const basisIds = created.obligationBasis || [];
    const ruleIds = created.applicabilityRule || [];

    let removedTemplates = 0;
    let removedBases = 0;
    let removedRules = 0;

    if (ruleIds.length > 0) {
      const r = await this.prisma.applicabilityRule.deleteMany({ where: { id: { in: ruleIds } } });
      removedRules = r.count;
    }
    if (basisIds.length > 0) {
      const r = await this.prisma.obligationBasis.deleteMany({ where: { id: { in: basisIds } } });
      removedBases = r.count;
    }
    if (templateIds.length > 0) {
      const blocked = await this.prisma.ppmPlanItem.count({ where: { obligationTemplateId: { in: templateIds } } });
      if (blocked > 0) {
        throw new BadRequestException(`cannot rollback: ${blocked} PPM plan item(s) reference imported obligations`);
      }
      const r = await this.prisma.obligationTemplate.deleteMany({ where: { id: { in: templateIds } } });
      removedTemplates = r.count;
    }

    const updated = await this.prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: 'rolled_back',
        rolledBackAt: new Date(),
        rollbackReason: reason || null,
      },
    });
    return { ok: true, importJobId: updated.id, removedTemplates, removedBases, removedRules };
  }
}
