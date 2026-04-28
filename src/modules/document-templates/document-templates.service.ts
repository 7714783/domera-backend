import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const KINDS = ['sketch_form', 'printable', 'reference'];

@Injectable()
export class DocumentTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    params: { buildingId?: string; kind?: string; includeInactive?: boolean } = {},
  ) {
    const where: any = { tenantId };
    // Building scope: include tenant-wide (buildingId=null) + those matching the given building.
    if (params.buildingId) {
      where.OR = [{ buildingId: null }, { buildingId: params.buildingId }];
    }
    if (params.kind) where.kind = params.kind;
    if (!params.includeInactive) where.isActive = true;
    return this.prisma.documentTemplate.findMany({
      where,
      orderBy: [{ buildingId: 'asc' }, { name: 'asc' }],
      take: 500,
    });
  }

  async get(tenantId: string, id: string) {
    const t = await this.prisma.documentTemplate.findFirst({ where: { id, tenantId } });
    if (!t) throw new NotFoundException('template not found');
    return t;
  }

  async create(
    tenantId: string,
    actorUserId: string,
    body: {
      key: string;
      name: string;
      kind: string;
      description?: string;
      buildingId?: string;
      documentTypeKey?: string;
      bodyMarkdown?: string;
      sampleDocumentId?: string;
      requiresPhoto?: boolean;
      requiresDigitalSignoff?: boolean;
      retentionYears?: number;
    },
  ) {
    if (!body.key || !body.name || !body.kind)
      throw new BadRequestException('key, name, kind required');
    if (!KINDS.includes(body.kind))
      throw new BadRequestException(`kind must be one of ${KINDS.join(', ')}`);
    if (body.kind === 'sketch_form' && !body.bodyMarkdown) {
      throw new BadRequestException('sketch_form requires bodyMarkdown');
    }
    if ((body.kind === 'printable' || body.kind === 'reference') && !body.sampleDocumentId) {
      throw new BadRequestException(
        `${body.kind} requires sampleDocumentId (upload a Document first)`,
      );
    }
    if (body.sampleDocumentId) {
      const sample = await this.prisma.document.findFirst({
        where: { id: body.sampleDocumentId, tenantId },
      });
      if (!sample) throw new NotFoundException('sampleDocumentId not found in this tenant');
    }
    const existing = await this.prisma.documentTemplate.findUnique({
      where: { tenantId_key: { tenantId, key: body.key } },
    });
    if (existing)
      throw new BadRequestException(
        `template with key "${body.key}" already exists — pick another`,
      );

    return this.prisma.documentTemplate.create({
      data: {
        tenantId,
        buildingId: body.buildingId || null,
        key: body.key,
        name: body.name,
        description: body.description || null,
        kind: body.kind,
        documentTypeKey: body.documentTypeKey || null,
        bodyMarkdown: body.bodyMarkdown || null,
        sampleDocumentId: body.sampleDocumentId || null,
        requiresPhoto: !!body.requiresPhoto,
        requiresDigitalSignoff: !!body.requiresDigitalSignoff,
        retentionYears: body.retentionYears ?? null,
        createdByUserId: actorUserId,
      },
    });
  }

  /**
   * Returns everywhere this template is referenced: PPM programs via
   * PpmTemplate.evidenceDocumentTemplateId + round waypoints via
   * RoundWaypoint.documentTemplateId. Used by the UI "applied to" tab.
   */
  async appliedTo(tenantId: string, id: string) {
    const tpl = await this.prisma.documentTemplate.findFirst({ where: { id, tenantId } });
    if (!tpl) throw new NotFoundException('template not found');
    const [ppmTemplates, waypoints] = await Promise.all([
      this.prisma.ppmTemplate.findMany({
        where: { tenantId, evidenceDocumentTemplateId: id },
        select: { id: true, name: true, buildingId: true, domain: true },
      }),
      this.prisma.roundWaypoint.findMany({
        where: { tenantId, documentTemplateId: id },
        include: { round: { select: { id: true, name: true, buildingId: true } } },
      }),
    ]);
    return {
      template: { id: tpl.id, key: tpl.key, name: tpl.name, kind: tpl.kind },
      ppmTemplates,
      rounds: waypoints.map((w) => ({
        roundId: w.round.id,
        roundName: w.round.name,
        buildingId: w.round.buildingId,
        waypointId: w.id,
        waypointLabel: w.label,
      })),
      total: ppmTemplates.length + waypoints.length,
    };
  }

  async update(
    tenantId: string,
    id: string,
    body: Partial<{
      name: string;
      description: string;
      kind: string;
      documentTypeKey: string;
      bodyMarkdown: string;
      sampleDocumentId: string | null;
      requiresPhoto: boolean;
      requiresDigitalSignoff: boolean;
      retentionYears: number | null;
      isActive: boolean;
      buildingId: string | null;
    }>,
  ) {
    const existing = await this.prisma.documentTemplate.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('template not found');
    if (body.kind && !KINDS.includes(body.kind))
      throw new BadRequestException(`kind must be one of ${KINDS.join(', ')}`);
    return this.prisma.documentTemplate.update({ where: { id }, data: body });
  }

  async delete(tenantId: string, id: string) {
    const t = await this.prisma.documentTemplate.findFirst({ where: { id, tenantId } });
    if (!t) throw new NotFoundException('template not found');
    // Refuse hard-delete if any PPM template references it.
    const inUse = await this.prisma.ppmTemplate.count({
      where: { evidenceDocumentTemplateId: id },
    });
    if (inUse > 0) {
      throw new ForbiddenException(
        `template is referenced by ${inUse} PPM program(s); deactivate instead`,
      );
    }
    await this.prisma.documentTemplate.delete({ where: { id } });
    return { ok: true };
  }
}
