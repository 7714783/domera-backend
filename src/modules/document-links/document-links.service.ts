import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const ALLOWED_TARGETS = [
  'ppm_task',
  'work_order',
  'equipment',
  'lease',
  'quote',
  'purchase_order',
  'project',
  'incident',
  'service_request',
  'takeover_case',
];

@Injectable()
export class DocumentLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async listForTarget(tenantId: string, targetType: string, targetId: string) {
    return this.prisma.documentLink.findMany({
      where: { tenantId, targetType, targetId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForDocument(tenantId: string, documentId: string) {
    return this.prisma.documentLink.findMany({
      where: { tenantId, documentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(tenantId: string, actorUserId: string, body: {
    documentId: string; targetType: string; targetId: string;
  }) {
    if (!body.documentId || !body.targetType || !body.targetId) {
      throw new BadRequestException('documentId, targetType, targetId required');
    }
    if (!ALLOWED_TARGETS.includes(body.targetType)) {
      throw new BadRequestException(`targetType must be one of ${ALLOWED_TARGETS.join(', ')}`);
    }
    const doc = await this.prisma.document.findFirst({
      where: { id: body.documentId, tenantId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('document not found');
    return this.prisma.documentLink.upsert({
      where: {
        documentId_targetType_targetId: {
          documentId: body.documentId,
          targetType: body.targetType,
          targetId: body.targetId,
        },
      },
      create: {
        tenantId,
        documentId: body.documentId,
        targetType: body.targetType,
        targetId: body.targetId,
        createdBy: actorUserId,
      },
      update: {},
    });
  }

  async delete(tenantId: string, id: string) {
    const existing = await this.prisma.documentLink.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('link not found');
    await this.prisma.documentLink.delete({ where: { id } });
    return { ok: true };
  }
}
