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
