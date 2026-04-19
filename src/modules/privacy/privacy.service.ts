import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DSAR_KINDS = ['access', 'delete', 'restrict', 'portability'];
const LAWFUL_BASIS = ['contract', 'consent', 'legal_obligation', 'legitimate_interest', 'vital_interest', 'public_task'];

@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Personal data inventory + retention matrix ─────────
  async listCategories(tenantId: string) {
    return this.prisma.personalDataCategory.findMany({
      where: { tenantId }, orderBy: { key: 'asc' },
    });
  }

  async upsertCategory(tenantId: string, actorUserId: string, body: {
    key: string; name: string; lawfulBasis: string;
    retentionDays?: number | null; location: string;
    processors?: string[]; notes?: string;
  }) {
    if (!body.key || !body.name || !body.lawfulBasis || !body.location) {
      throw new BadRequestException('key, name, lawfulBasis, location required');
    }
    if (!LAWFUL_BASIS.includes(body.lawfulBasis)) {
      throw new BadRequestException(`lawfulBasis must be one of ${LAWFUL_BASIS.join(', ')}`);
    }
    const row = await this.prisma.personalDataCategory.upsert({
      where: { tenantId_key: { tenantId, key: body.key } },
      create: {
        tenantId, key: body.key, name: body.name, lawfulBasis: body.lawfulBasis,
        retentionDays: body.retentionDays ?? null, location: body.location,
        processors: body.processors || [], notes: body.notes || null,
      },
      update: {
        name: body.name, lawfulBasis: body.lawfulBasis,
        retentionDays: body.retentionDays ?? null, location: body.location,
        processors: body.processors || [], notes: body.notes || null,
      },
    });
    await this.audit.write({
      tenantId, actor: actorUserId, role: 'dpo',
      action: 'privacy.category.upserted', entity: row.id, entityType: 'personal_data_category',
      building: '-', ip: '-', sensitive: true,
    });
    return row;
  }

  async seedBuiltIns(tenantId: string, actorUserId: string) {
    const base: Array<Omit<Parameters<PrivacyService['upsertCategory']>[2], 'notes'> & { notes?: string }> = [
      { key: 'user_identity', name: 'User identity (email, display name)', lawfulBasis: 'contract', retentionDays: null, location: 'users,sessions', processors: [] },
      { key: 'tenant_rep_contact', name: 'Tenant representative contact', lawfulBasis: 'contract', retentionDays: 2555, location: 'tenant_representatives,building_occupant_companies' },
      { key: 'lease_contract', name: 'Lease contract data', lawfulBasis: 'legal_obligation', retentionDays: 2555, location: 'building_contracts' },
      { key: 'service_request_submitter', name: 'Service request submitter contact', lawfulBasis: 'legitimate_interest', retentionDays: 730, location: 'service_requests' },
      { key: 'incident_reporter', name: 'Incident reporter identity', lawfulBasis: 'legal_obligation', retentionDays: 2555, location: 'incidents' },
      { key: 'audit_log_actor', name: 'Audit log actor identifiers', lawfulBasis: 'legal_obligation', retentionDays: null, location: 'audit_entries' },
      { key: 'photo_evidence', name: 'Photos attached to service requests / completions', lawfulBasis: 'legitimate_interest', retentionDays: 1825, location: 'documents,service_requests' },
    ];
    const results = [] as any[];
    for (const b of base) results.push(await this.upsertCategory(tenantId, actorUserId, b as any));
    return { seeded: results.length, items: results };
  }

  // ── Records of Processing Activity (RoPA) export ───────
  async ropa(tenantId: string) {
    const cats = await this.prisma.personalDataCategory.findMany({ where: { tenantId }, orderBy: { key: 'asc' } });
    const [users, reps, occupants] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.tenantRepresentative.count({ where: { tenantId } }),
      this.prisma.buildingOccupantCompany.count({ where: { tenantId } }),
    ]);
    return {
      controller: { tenantId },
      categories: cats.map((c) => ({
        key: c.key, name: c.name, lawfulBasis: c.lawfulBasis,
        retentionDays: c.retentionDays, location: c.location, processors: c.processors,
      })),
      subjectCounts: { users, tenantRepresentatives: reps, occupantCompanies: occupants },
      lastGeneratedAt: new Date().toISOString(),
    };
  }

  // ── DSAR ───────────────────────────────────────────────
  async createDsar(tenantId: string, body: {
    subjectEmail: string; subjectUserId?: string; kind: string;
  }) {
    if (!body.subjectEmail) throw new BadRequestException('subjectEmail required');
    if (!DSAR_KINDS.includes(body.kind)) {
      throw new BadRequestException(`kind must be one of ${DSAR_KINDS.join(', ')}`);
    }
    return this.prisma.dsarRequest.create({
      data: {
        tenantId,
        subjectEmail: body.subjectEmail.toLowerCase(),
        subjectUserId: body.subjectUserId || null,
        kind: body.kind,
      },
    });
  }

  async listDsar(tenantId: string, status?: string) {
    const where: any = { tenantId };
    if (status) where.status = status;
    return this.prisma.dsarRequest.findMany({
      where, orderBy: { requestedAt: 'desc' }, take: 100,
    });
  }

  // ── Subprocessor registry ──────────────────────────────
  async listSubprocessors(tenantId: string, params: { status?: string; category?: string } = {}) {
    const where: any = { tenantId };
    if (params.status) where.status = params.status;
    if (params.category) where.category = params.category;
    return this.prisma.subprocessorRegistry.findMany({
      where, orderBy: { name: 'asc' },
    });
  }

  async upsertSubprocessor(tenantId: string, actorUserId: string, body: {
    name: string; legalEntity?: string; countryCode?: string; category: string;
    websiteUrl?: string; dpoEmail?: string; region?: string;
    dataCategories?: string[]; notes?: string; status?: string;
  }) {
    if (!body.name || !body.category) throw new BadRequestException('name and category required');
    const allowedStatus = ['active', 'suspended', 'retired'];
    if (body.status && !allowedStatus.includes(body.status)) {
      throw new BadRequestException(`status must be one of ${allowedStatus.join(', ')}`);
    }
    const existing = await this.prisma.subprocessorRegistry.findUnique({
      where: { tenantId_name: { tenantId, name: body.name } },
    });
    const data = {
      tenantId, name: body.name, legalEntity: body.legalEntity || null,
      countryCode: body.countryCode || null, category: body.category,
      websiteUrl: body.websiteUrl || null, dpoEmail: body.dpoEmail || null,
      region: body.region || null,
      dataCategories: body.dataCategories || [],
      notes: body.notes || null,
      status: body.status || 'active',
    };
    const row = existing
      ? await this.prisma.subprocessorRegistry.update({ where: { id: existing.id }, data })
      : await this.prisma.subprocessorRegistry.create({ data });
    await this.audit.write({
      tenantId, actor: actorUserId, role: 'dpo',
      action: existing ? 'privacy.subprocessor.updated' : 'privacy.subprocessor.added',
      entity: row.id, entityType: 'subprocessor',
      building: '-', ip: '-', sensitive: true,
    });
    return row;
  }

  async approveSubprocessor(tenantId: string, actorUserId: string, id: string) {
    const sp = await this.prisma.subprocessorRegistry.findFirst({ where: { id, tenantId } });
    if (!sp) throw new NotFoundException('subprocessor not found');
    return this.prisma.subprocessorRegistry.update({
      where: { id },
      data: { approvedAt: new Date(), approvedByUserId: actorUserId, status: 'active' },
    });
  }

  async retireSubprocessor(tenantId: string, actorUserId: string, id: string) {
    const sp = await this.prisma.subprocessorRegistry.findFirst({ where: { id, tenantId } });
    if (!sp) throw new NotFoundException('subprocessor not found');
    return this.prisma.subprocessorRegistry.update({
      where: { id }, data: { status: 'retired' },
    });
  }

  async seedSubprocessors(tenantId: string, actorUserId: string) {
    const seeds = [
      { name: 'PostgreSQL hosting (managed)', legalEntity: 'Tenant choice', category: 'hosting', region: 'EU/IL', dataCategories: ['user_identity', 'tenant_rep_contact', 'lease_contract', 'audit_log_actor'] },
      { name: 'S3-compatible object storage', legalEntity: 'Tenant choice', category: 'storage', region: 'EU/IL', dataCategories: ['photo_evidence'] },
      { name: 'Transactional email (SES/SendGrid)', legalEntity: 'Tenant choice', category: 'email', region: 'EU/IL', dataCategories: ['user_identity', 'service_request_submitter'] },
      { name: 'SMS gateway (Twilio/Pelephone)', legalEntity: 'Tenant choice', category: 'sms', region: 'IL/Global', dataCategories: ['service_request_submitter'] },
    ];
    const out = [];
    for (const s of seeds) out.push(await this.upsertSubprocessor(tenantId, actorUserId, s as any));
    return { seeded: out.length, items: out };
  }

  // ── DPA templates ──────────────────────────────────────
  async listDpaTemplates(tenantId: string, params: { jurisdiction?: string; includeInactive?: boolean } = {}) {
    const where: any = { tenantId };
    if (params.jurisdiction) where.jurisdiction = params.jurisdiction;
    if (!params.includeInactive) where.isActive = true;
    return this.prisma.dpaTemplate.findMany({
      where, orderBy: [{ key: 'asc' }, { jurisdiction: 'asc' }, { version: 'desc' }],
    });
  }

  async createDpaTemplate(tenantId: string, actorUserId: string, body: {
    key: string; name: string; jurisdiction?: string; bodyMarkdown: string;
    placeholders?: string[]; retentionYears?: number;
  }) {
    if (!body.key || !body.name || !body.bodyMarkdown) {
      throw new BadRequestException('key, name, bodyMarkdown required');
    }
    // Auto-version: archive previous active for same (key, jurisdiction)
    const prev = await this.prisma.dpaTemplate.findFirst({
      where: { tenantId, key: body.key, jurisdiction: body.jurisdiction || 'EU' },
      orderBy: { version: 'desc' },
    });
    return this.prisma.$transaction(async (tx) => {
      if (prev?.isActive) {
        await tx.dpaTemplate.update({
          where: { id: prev.id },
          data: { isActive: false, effectiveUntil: new Date() },
        });
      }
      const created = await tx.dpaTemplate.create({
        data: {
          tenantId, key: body.key, name: body.name,
          jurisdiction: body.jurisdiction || 'EU',
          version: prev ? prev.version + 1 : 1,
          isActive: true,
          bodyMarkdown: body.bodyMarkdown,
          placeholders: body.placeholders || [],
          retentionYears: body.retentionYears ?? null,
          supersedesId: prev?.id ?? null,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.write({
        tenantId, actor: actorUserId, role: 'dpo',
        action: prev ? 'privacy.dpa.superseded' : 'privacy.dpa.created',
        entity: created.id, entityType: 'dpa_template',
        building: '-', ip: '-', sensitive: true,
      });
      return created;
    });
  }

  async renderDpaTemplate(tenantId: string, id: string, values: Record<string, string>) {
    const tpl = await this.prisma.dpaTemplate.findFirst({ where: { id, tenantId } });
    if (!tpl) throw new NotFoundException('DPA template not found');
    const required = (tpl.placeholders || []) as string[];
    const missing = required.filter((k) => !(k in values));
    if (missing.length) {
      throw new BadRequestException(`missing placeholders: ${missing.join(', ')}`);
    }
    let body = tpl.bodyMarkdown;
    for (const k of required) {
      body = body.split(`{{${k}}}`).join(values[k]);
    }
    return {
      templateId: tpl.id, key: tpl.key, version: tpl.version, jurisdiction: tpl.jurisdiction,
      renderedAt: new Date().toISOString(), values, body,
    };
  }

  async seedDpaTemplates(tenantId: string, actorUserId: string) {
    const seeds = [
      {
        key: 'controller_to_processor',
        name: 'Standard Controller → Processor DPA (EU GDPR)',
        jurisdiction: 'EU',
        retentionYears: 7,
        placeholders: ['controllerName', 'processorName', 'effectiveDate', 'subjectMatter', 'durationMonths', 'dpoEmail'],
        bodyMarkdown: `# Data Processing Agreement\n\nThis DPA is entered into between **{{controllerName}}** ("Controller") and **{{processorName}}** ("Processor") effective {{effectiveDate}}.\n\n## 1. Subject matter & duration\n{{subjectMatter}} for {{durationMonths}} months.\n\n## 2. Categories of data + subjects\nPer the Controller's Records of Processing (RoPA) made available to the Processor on request.\n\n## 3. Sub-processing\nProcessor must obtain prior written authorization for any sub-processor and update the published list within 30 days.\n\n## 4. Security\nTOM appendix incorporated by reference (encryption at rest + in transit, access logs, MFA for privileged roles, quarterly DR drill).\n\n## 5. Subject rights & breach notice\nProcessor must support DSAR fulfilment within 5 working days and notify the Controller of any incident within 72 hours.\n\n## 6. Data return / deletion\nOn termination, Processor returns or deletes data per Controller's instruction within 30 days.\n\nDPO: {{dpoEmail}}`,
      },
      {
        key: 'tom_addendum',
        name: 'Technical & Organisational Measures Addendum',
        jurisdiction: 'EU',
        placeholders: ['processorName', 'effectiveDate'],
        bodyMarkdown: `# TOM Addendum — {{processorName}} (effective {{effectiveDate}})\n\n- Encryption at rest (AES-256-GCM) and in transit (TLS 1.2+)\n- RBAC with least-privilege; MFA for privileged roles\n- Centralised audit logging, retained ≥1 year\n- Backups encrypted, offline copy with 2-person restore approval\n- Annual penetration test, quarterly DR drill\n- Sub-processor approval gate + 30-day public notice`,
      },
      {
        key: 'controller_to_processor',
        name: 'IL PPL controller-to-processor DPA',
        jurisdiction: 'IL',
        retentionYears: 7,
        placeholders: ['controllerName', 'processorName', 'effectiveDate', 'dpoEmail'],
        bodyMarkdown: `# הסכם עיבוד נתונים\n\nבין **{{controllerName}}** ל־**{{processorName}}**, החל מ־{{effectiveDate}}.\n\nהמעבד יפעל ע"פ חוק הגנת הפרטיות התשמ"א־1981, לרבות יידוע על אירוע אבטחת מידע תוך 72 שעות, ומחיקה תוך 30 יום מסיום ההתקשרות.\n\nממונה הגנת הפרטיות: {{dpoEmail}}`,
      },
    ];
    const out = [];
    for (const s of seeds) out.push(await this.createDpaTemplate(tenantId, actorUserId, s as any));
    return { seeded: out.length, items: out };
  }

  async processDsar(tenantId: string, actorUserId: string, id: string) {
    const r = await this.prisma.dsarRequest.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('DSAR request not found');
    if (r.status !== 'received' && r.status !== 'verifying') {
      throw new BadRequestException(`cannot process DSAR in status ${r.status}`);
    }

    const summary: any = { subjectEmail: r.subjectEmail };

    if (r.kind === 'access' || r.kind === 'portability') {
      const user = r.subjectUserId
        ? await this.prisma.user.findUnique({ where: { id: r.subjectUserId } })
        : await this.prisma.user.findUnique({ where: { emailNormalized: r.subjectEmail } });
      if (user) {
        const [memberships, orgMemberships, buildingRoles, reps, sessions] = await Promise.all([
          this.prisma.membership.findMany({ where: { userId: user.id } }),
          this.prisma.organizationMembership.findMany({ where: { userId: user.id } }),
          this.prisma.buildingRoleAssignment.findMany({ where: { userId: user.id } }),
          this.prisma.tenantRepresentative.findMany({ where: { userId: user.id, tenantId } }),
          this.prisma.session.findMany({ where: { userId: user.id }, select: { id: true, createdAt: true, lastSeenAt: true, ipAddress: true, userAgent: true, revokedAt: true } }),
        ]);
        summary.identity = {
          id: user.id, email: user.email, displayName: user.displayName,
          createdAt: user.createdAt, lastLoginAt: user.lastLoginAt,
        };
        summary.memberships = memberships;
        summary.orgMemberships = orgMemberships;
        summary.buildingRoles = buildingRoles;
        summary.tenantRepresentatives = reps;
        summary.sessions = sessions;
      } else {
        summary.identity = null;
      }
    }

    if (r.kind === 'delete') {
      const user = r.subjectUserId
        ? await this.prisma.user.findUnique({ where: { id: r.subjectUserId } })
        : await this.prisma.user.findUnique({ where: { emailNormalized: r.subjectEmail } });
      if (user) {
        const anonymized = `deleted-${user.id.slice(0, 8)}@redacted.local`;
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            email: anonymized, emailNormalized: anonymized,
            displayName: 'Deleted User', passwordHash: null, status: 'deleted',
          },
        });
        await this.prisma.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date(), revokedBy: `dsar:${r.id}` },
        });
        summary.deleted = { userId: user.id, anonymizedEmail: anonymized };
      } else {
        summary.deleted = { note: 'no user matched subjectEmail; nothing to delete' };
      }
    }

    if (r.kind === 'restrict') {
      const user = await this.prisma.user.findUnique({ where: { emailNormalized: r.subjectEmail } });
      if (user) {
        await this.prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });
        summary.restricted = { userId: user.id };
      }
    }

    const updated = await this.prisma.dsarRequest.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        assignedToUserId: actorUserId,
        fulfilmentSummary: summary as any,
      },
    });
    await this.audit.write({
      tenantId, actor: actorUserId, role: 'dpo',
      action: `dsar.${r.kind}.completed`, entity: id, entityType: 'dsar_request',
      building: '-', ip: '-', sensitive: true,
    });
    return updated;
  }
}
