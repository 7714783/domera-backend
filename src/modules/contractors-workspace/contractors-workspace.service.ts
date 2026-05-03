// INIT-013 — per-workspace ↔ public-contractor link table.
//
// All reads/writes are RLS-scoped to the active tenant. Each row stores
// the workspace's PRIVATE relationship details (notes, agreed rate,
// internal rating, local contact person) — never exposed cross-workspace.

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface WorkspaceContractorCreate {
  publicContractorId: string;
  localDisplayName?: string;
  localContactPerson?: string;
  localContactPhone?: string;
  localContactEmail?: string;
  privateNotes?: string;
  preferredRate?: string;
  startedAt?: string;
}

export interface WorkspaceContractorUpdate
  extends Partial<Omit<WorkspaceContractorCreate, 'publicContractorId'>> {
  status?: 'active' | 'paused' | 'terminated';
  endedAt?: string | null;
}

@Injectable()
export class ContractorsWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, opts: { status?: string; search?: string } = {}) {
    const where: any = { tenantId };
    if (opts.status) where.status = opts.status;
    const items = await (this.prisma as any).workspaceContractor.findMany({
      where,
      include: { publicContractor: true },
      orderBy: [{ createdAt: 'desc' }],
    });
    const search = opts.search?.toLowerCase();
    const filtered = search
      ? items.filter((it: any) => {
          const q = search;
          return (
            (it.localDisplayName || '').toLowerCase().includes(q) ||
            (it.publicContractor?.displayName || '').toLowerCase().includes(q)
          );
        })
      : items;
    return { total: filtered.length, items: filtered };
  }

  async getOne(tenantId: string, id: string) {
    const r = await (this.prisma as any).workspaceContractor.findFirst({
      where: { id, tenantId },
      include: { publicContractor: true },
    });
    if (!r) throw new NotFoundException('workspace contractor not found');
    return r;
  }

  async create(tenantId: string, actor: string, body: WorkspaceContractorCreate) {
    if (!body.publicContractorId) {
      throw new BadRequestException('publicContractorId required');
    }
    const dup = await (this.prisma as any).workspaceContractor.findFirst({
      where: { tenantId, publicContractorId: body.publicContractorId },
    });
    if (dup) throw new ConflictException('contractor already linked to this workspace');

    const created = await (this.prisma as any).workspaceContractor.create({
      data: {
        tenantId,
        publicContractorId: body.publicContractorId,
        localDisplayName: body.localDisplayName ?? null,
        localContactPerson: body.localContactPerson ?? null,
        localContactPhone: body.localContactPhone ?? null,
        localContactEmail: body.localContactEmail ?? null,
        privateNotes: body.privateNotes ?? null,
        preferredRate: body.preferredRate ?? null,
        startedAt: body.startedAt ? new Date(body.startedAt) : null,
        status: 'active',
      },
    });

    await this.audit.write({
      tenantId,
      buildingId: null,
      actor,
      role: 'workspace',
      action: 'workspace_contractor.linked',
      entity: created.id,
      entityType: 'workspace_contractor',
      building: '',
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'workspace_contractor.created',
      resourceType: 'workspace_contractor',
      resourceId: created.id,
      metadata: { publicContractorId: body.publicContractorId },
    });
    return created;
  }

  async update(tenantId: string, actor: string, id: string, body: WorkspaceContractorUpdate) {
    const existing = await (this.prisma as any).workspaceContractor.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('workspace contractor not found');

    const data: any = {};
    if (body.localDisplayName !== undefined) data.localDisplayName = body.localDisplayName;
    if (body.localContactPerson !== undefined) data.localContactPerson = body.localContactPerson;
    if (body.localContactPhone !== undefined) data.localContactPhone = body.localContactPhone;
    if (body.localContactEmail !== undefined) data.localContactEmail = body.localContactEmail;
    if (body.privateNotes !== undefined) data.privateNotes = body.privateNotes;
    if (body.preferredRate !== undefined) data.preferredRate = body.preferredRate;
    if (body.status !== undefined) data.status = body.status;
    if (body.startedAt !== undefined) data.startedAt = body.startedAt ? new Date(body.startedAt) : null;
    if (body.endedAt !== undefined) data.endedAt = body.endedAt ? new Date(body.endedAt) : null;

    const updated = await (this.prisma as any).workspaceContractor.update({
      where: { id: existing.id },
      data,
    });

    await this.audit.write({
      tenantId,
      buildingId: null,
      actor,
      role: 'workspace',
      action: 'workspace_contractor.updated',
      entity: updated.id,
      entityType: 'workspace_contractor',
      building: '',
      ip: '127.0.0.1',
      sensitive: false,
      eventType: 'workspace_contractor.updated',
      resourceType: 'workspace_contractor',
      resourceId: updated.id,
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  }

  async unlink(tenantId: string, actor: string, id: string) {
    const existing = await (this.prisma as any).workspaceContractor.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('workspace contractor not found');
    // Soft-end rather than hard-delete to preserve audit history. The
    // tenant won't see terminated rows by default in the UI.
    const updated = await (this.prisma as any).workspaceContractor.update({
      where: { id: existing.id },
      data: { status: 'terminated', endedAt: new Date() },
    });
    await this.audit.write({
      tenantId,
      buildingId: null,
      actor,
      role: 'workspace',
      action: 'workspace_contractor.terminated',
      entity: updated.id,
      entityType: 'workspace_contractor',
      building: '',
      ip: '127.0.0.1',
      sensitive: true,
      eventType: 'workspace_contractor.terminated',
      resourceType: 'workspace_contractor',
      resourceId: updated.id,
    });
    return updated;
  }
}
