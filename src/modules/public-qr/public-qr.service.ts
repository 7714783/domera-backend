import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
// @ts-expect-error — qrcode ships no types; interface narrowed inline below.
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/tenant-context';
import { AssignmentResolverService } from '../assignment/assignment.resolver';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ResolvedQr = {
  qrId: string;
  tenantId: string;
  buildingId: string;
  code: string;
  label: string;
  targetType: string;
  floorId: string | null;
  unitId: string | null;
  equipmentId: string | null;
  spaceId: string | null;
  notes: string | null;
};

@Injectable()
export class PublicQrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentResolver: AssignmentResolverService,
  ) {}

  /** Resolve a public QR id via SECURITY DEFINER RPC (no tenant context). */
  private async resolveRaw(qrId: string): Promise<ResolvedQr> {
    if (!UUID_RE.test(qrId)) throw new BadRequestException('invalid qr id');
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select * from public_resolve_qr('${qrId}'::uuid)`,
    );
    if (!rows?.length) throw new NotFoundException('QR not found');
    return rows[0] as ResolvedQr;
  }

  private async fetchBuildingPublic(
    bid: string,
  ): Promise<{ id: string; slug: string; name: string; city: string | null } | null> {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select * from public_qr_building('${bid.replace(/'/g, "''")}')`,
    );
    return rows?.[0] || null;
  }

  /** Public scan endpoint payload — minimum info to render the landing form. */
  async getLanding(qrId: string) {
    const qr = await this.resolveRaw(qrId);
    const building = await this.fetchBuildingPublic(qr.buildingId);
    return {
      qr: {
        id: qr.qrId,
        code: qr.code,
        label: qr.label,
        targetType: qr.targetType,
      },
      building: building
        ? { id: building.id, slug: building.slug, name: building.name, city: building.city }
        : null,
      categories: [
        'cleaning',
        'technical',
        'complaint',
        'safety',
        'elevator',
        'parking',
        'restroom',
        'other',
      ],
    };
  }

  /** Anonymous submission, scoped to the QR's tenant + building. */
  async submit(
    qrId: string,
    body: {
      category?: string;
      priority?: 'low' | 'normal' | 'high';
      description?: string;
      photoKey?: string;
      submitterContact?: string;
    },
  ) {
    if (!body?.category) throw new BadRequestException('category required');
    const qr = await this.resolveRaw(qrId);

    // Run the write under the resolved tenant context so RLS applies.
    return TenantContext.run({ tenantId: qr.tenantId }, async () => {
      const decision = await this.assignmentResolver.resolve({
        tenantId: qr.tenantId,
        buildingId: qr.buildingId,
        floorId: qr.floorId,
        roleKey: 'technician',
      });
      return this.prisma.serviceRequest.create({
        data: {
          tenantId: qr.tenantId,
          buildingId: qr.buildingId,
          qrLocationId: qr.qrId,
          unitId: qr.unitId || null,
          floorId: qr.floorId || null,
          category: body.category!,
          priority: body.priority || 'normal',
          status: 'new',
          description: body.description || null,
          photoKey: body.photoKey || null,
          submittedBy: null, // anonymous
          submitterContact: body.submitterContact || null,
          assignedUserId: decision.userId,
          assignmentSource: decision.source,
          assignmentReason: decision.reason,
        },
        select: { id: true, status: true, createdAt: true },
      });
    });
  }

  async qrPngDataUrl(qrId: string, baseUrl: string): Promise<{ dataUrl: string; scanUrl: string }> {
    if (!UUID_RE.test(qrId)) throw new BadRequestException('invalid qr id');
    const scanUrl = `${baseUrl.replace(/\/$/, '')}/qr/${qrId}`;
    const dataUrl = await QRCode.toDataURL(scanUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#111827', light: '#ffffff' },
    });
    return { dataUrl, scanUrl };
  }

  async qrPngBuffer(qrId: string, baseUrl: string): Promise<Buffer> {
    if (!UUID_RE.test(qrId)) throw new BadRequestException('invalid qr id');
    const scanUrl = `${baseUrl.replace(/\/$/, '')}/qr/${qrId}`;
    return QRCode.toBuffer(scanUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
      type: 'png',
    });
  }
}
