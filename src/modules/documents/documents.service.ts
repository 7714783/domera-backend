import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorage } from './storage';

export const OBJECT_STORAGE = 'OBJECT_STORAGE';

const MIME_ALLOWLIST = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'text/plain',
  'text/csv',
  'application/zip',
]);

const RETENTION_CLASSES: Record<string, number | null> = {
  short: 1,
  standard: 3,
  statutory_7y: 7,
  permanent: null,
};

function sniffMime(first4: Buffer): string | null {
  if (first4.length < 4) return null;
  if (first4.slice(0, 4).toString('utf8') === '%PDF') return 'application/pdf';
  if (first4[0] === 0x89 && first4[1] === 0x50 && first4[2] === 0x4e && first4[3] === 0x47)
    return 'image/png';
  if (first4[0] === 0xff && first4[1] === 0xd8 && first4[2] === 0xff) return 'image/jpeg';
  if (first4[0] === 0x50 && first4[1] === 0x4b && first4[2] === 0x03 && first4[3] === 0x04)
    return 'application/zip'; // includes xlsx/docx
  return null;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async upload(
    tenantId: string,
    actorUserId: string,
    buildingId: string,
    body: {
      title: string;
      documentType: string;
      documentTypeKey?: string;
      mimeType?: string;
      retentionClass?: string;
      summary?: string;
      buf: Buffer;
    },
  ) {
    if (!body.title || !body.documentType || !body.buf || body.buf.length === 0) {
      throw new BadRequestException('title, documentType, and file buffer required');
    }

    const sniffed = sniffMime(body.buf.slice(0, 4));
    const declaredMime = (body.mimeType || '').toLowerCase();
    const effectiveMime = sniffed || declaredMime || 'application/octet-stream';
    if (!MIME_ALLOWLIST.has(effectiveMime)) {
      throw new BadRequestException(`mime type "${effectiveMime}" is not on the allowlist`);
    }
    if (
      sniffed &&
      declaredMime &&
      sniffed !== declaredMime &&
      !(sniffed === 'application/zip' && declaredMime.startsWith('application/vnd.openxmlformats'))
    ) {
      throw new BadRequestException(
        `declared mime "${declaredMime}" does not match content "${sniffed}"`,
      );
    }

    const sha256 = createHash('sha256').update(body.buf).digest('hex');
    const storageKey = `t/${tenantId}/b/${buildingId}/d/${sha256}`;
    await this.storage.put(storageKey, body.buf, { mimeType: effectiveMime });

    const retentionClass =
      body.retentionClass && RETENTION_CLASSES[body.retentionClass] !== undefined
        ? body.retentionClass
        : 'standard';
    const retentionYears = RETENTION_CLASSES[retentionClass];
    const retentionUntil = retentionYears
      ? new Date(Date.now() + retentionYears * 365 * 86400000)
      : null;

    const searchText = [
      body.title,
      body.documentType,
      body.documentTypeKey,
      body.summary,
      effectiveMime,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const doc = await this.prisma.document.create({
      data: {
        tenantId,
        buildingId,
        title: body.title,
        documentType: body.documentType,
        documentTypeKey: body.documentTypeKey || null,
        status: 'uploaded',
        versionNo: 1,
        storageKey,
        sha256,
        mimeType: effectiveMime,
        sizeBytes: body.buf.length,
        virusScanStatus: 'pending',
        retentionClass,
        retentionUntil,
        legalHold: false,
        searchText,
        createdBy: actorUserId,
      },
    });
    return doc;
  }

  async setLegalHold(
    tenantId: string,
    actorUserId: string,
    id: string,
    on: boolean,
    reason?: string,
  ) {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('document not found');
    if (on === doc.legalHold) return doc;
    return this.prisma.document.update({
      where: { id },
      data: {
        legalHold: on,
        legalHoldReason: on ? reason || null : null,
        legalHoldSetAt: on ? new Date() : null,
        legalHoldSetBy: on ? actorUserId : null,
      },
    });
  }

  async delete(tenantId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('document not found');
    if (doc.legalHold) throw new ForbiddenException('document is under legal hold');
    if (doc.retentionUntil && doc.retentionUntil.getTime() > Date.now()) {
      throw new ForbiddenException(
        `retention period active until ${doc.retentionUntil.toISOString().slice(0, 10)}`,
      );
    }
    await this.storage.del(doc.storageKey);
    await this.prisma.document.delete({ where: { id } });
    return { ok: true };
  }

  async recordVirusScan(tenantId: string, id: string, status: 'clean' | 'infected' | 'unscanned') {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('document not found');
    return this.prisma.document.update({
      where: { id },
      data: { virusScanStatus: status, virusScanAt: new Date() },
    });
  }

  async issueSignedUrl(tenantId: string, actorUserId: string, id: string, ttlSeconds: number) {
    const doc = await this.prisma.document.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundException('document not found');
    if (doc.virusScanStatus === 'infected') throw new ForbiddenException('document is quarantined');
    const ttl = Math.min(Math.max(ttlSeconds || 300, 30), 24 * 3600);
    const token = randomBytes(24).toString('hex');
    const row = await this.prisma.signedUrl.create({
      data: {
        tenantId,
        documentId: id,
        token,
        expiresAt: new Date(Date.now() + ttl * 1000),
        usesLeft: 1,
        createdByUserId: actorUserId,
      },
    });
    const base = process.env.API_URL || 'http://localhost:4000';
    return {
      url: `${base}/v1/documents/signed/${token}`,
      expiresAt: row.expiresAt,
      usesLeft: row.usesLeft,
    };
  }

  async redeemSignedUrl(
    token: string,
  ): Promise<{ body: Buffer; mimeType: string | null; title: string }> {
    const row = await this.prisma.signedUrl.findUnique({ where: { token } });
    if (!row) throw new NotFoundException('signed url not found');
    if (row.expiresAt.getTime() < Date.now()) throw new ForbiddenException('signed url expired');
    if (row.usesLeft <= 0) throw new ForbiddenException('signed url exhausted');
    const doc = await this.prisma.document.findFirst({
      where: { id: row.documentId, tenantId: row.tenantId },
    });
    if (!doc) throw new NotFoundException('document not found');
    if (doc.virusScanStatus === 'infected') throw new ForbiddenException('document is quarantined');

    await this.prisma.signedUrl.update({
      where: { id: row.id },
      data: { usesLeft: row.usesLeft - 1, usedAt: new Date() },
    });
    const body = await this.storage.get(doc.storageKey);
    return { body, mimeType: doc.mimeType, title: doc.title };
  }

  async search(
    tenantId: string,
    params: {
      q?: string;
      legalHoldOnly?: boolean;
      retentionClass?: string;
      take?: number;
      skip?: number;
    },
  ) {
    const take = Math.min(Math.max(params.take || 25, 1), 200);
    const skip = Math.max(params.skip || 0, 0);
    const where: any = { tenantId };
    if (params.q) {
      const q = params.q.toLowerCase();
      where.OR = [
        { searchText: { contains: q } },
        { title: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    if (params.legalHoldOnly) where.legalHold = true;
    if (params.retentionClass) where.retentionClass = params.retentionClass;
    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          documentType: true,
          documentTypeKey: true,
          status: true,
          versionNo: true,
          sha256: true,
          mimeType: true,
          sizeBytes: true,
          virusScanStatus: true,
          retentionClass: true,
          retentionUntil: true,
          legalHold: true,
          legalHoldReason: true,
          createdAt: true,
        },
      }),
      this.prisma.document.count({ where }),
    ]);
    return { total, items };
  }
}
