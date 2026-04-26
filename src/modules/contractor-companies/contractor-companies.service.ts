// INIT-007 Phase 6 — universal ContractorCompany CRUD.
//
// Cleaning has CleaningContractor (cleaning-specific). Technical /
// security work has been routed via Organization (type=vendor) until now.
// ContractorCompany is the unified record that lets a CONTRACTOR_MANAGER
// scope its grants across multiple domains in a single FK.
//
// Listing + create are manager-gated (workspace owner / building manager).
// Mutations are audit-logged.

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { requireManager } from '../../common/building.helpers';
import { AuditService } from '../audit/audit.service';

const VALID_DOMAINS = ['cleaning', 'technical', 'security', 'generic'];

@Injectable()
export class ContractorCompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, params: { domain?: string; isActive?: string } = {}) {
    return this.prisma.contractorCompany.findMany({
      where: {
        tenantId,
        domain: params.domain || undefined,
        isActive:
          params.isActive === 'true' ? true : params.isActive === 'false' ? false : undefined,
      },
      orderBy: [{ domain: 'asc' }, { name: 'asc' }],
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.contractorCompany.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('contractor company not found');
    return row;
  }

  async create(
    tenantId: string,
    actorUserId: string,
    body: {
      name: string;
      domain: string;
      legalName?: string;
      phone?: string;
      email?: string;
      notes?: string;
    },
  ) {
    if (!body?.name) throw new BadRequestException('name required');
    if (!body?.domain || !VALID_DOMAINS.includes(body.domain)) {
      throw new BadRequestException(`domain must be one of ${VALID_DOMAINS.join(', ')}`);
    }
    await requireManager(this.prisma, tenantId, actorUserId);

    const created = await this.prisma.contractorCompany.create({
      data: {
        tenantId,
        name: body.name.trim(),
        domain: body.domain,
        legalName: body.legalName || null,
        phone: body.phone || null,
        email: body.email || null,
        notes: body.notes || null,
      },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'manager',
      action: 'ContractorCompany created',
      entity: created.id,
      entityType: 'contractor_company',
      building: '',
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'contractor_company.created',
      resourceType: 'contractor_company',
      resourceId: created.id,
      metadata: { name: created.name, domain: created.domain },
    });
    return created;
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    body: Partial<{
      name: string;
      legalName: string | null;
      phone: string | null;
      email: string | null;
      notes: string | null;
      isActive: boolean;
    }>,
  ) {
    await requireManager(this.prisma, tenantId, actorUserId);
    const existing = await this.prisma.contractorCompany.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('contractor company not found');

    const updated = await this.prisma.contractorCompany.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        legalName: body.legalName ?? undefined,
        phone: body.phone ?? undefined,
        email: body.email ?? undefined,
        notes: body.notes ?? undefined,
        isActive: body.isActive ?? undefined,
      },
    });
    await this.audit.write({
      tenantId,
      actor: actorUserId,
      role: 'manager',
      action: 'ContractorCompany updated',
      entity: id,
      entityType: 'contractor_company',
      building: '',
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'contractor_company.updated',
      resourceType: 'contractor_company',
      resourceId: id,
      metadata: { changes: body },
    });
    return updated;
  }
}
