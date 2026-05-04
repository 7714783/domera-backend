// GROWTH-001 NS-24 — opaque-token resolver for mobile.
//
// Single endpoint POST /v1/scanner/resolve { token } -> typed result.
// Mobile (apps/mobile/src/scanner/scannerApi.ts) calls this with
// whatever bytes were decoded from a QR code; the server decides the
// kind. This is the ONE place where token shape is mapped to domain
// intent — adding a new scan target type = extending this service,
// no client change beyond an extra `kind`.
//
// Resolution order (first hit wins):
//
//   1. CleaningQrPoint.code  — public-facing cleaning request form.
//                              "Random unguessable" tokens; tenant-
//                              scoped via the row's tenantId.
//                              Returns kind='cleaning_request_form'.
//   2. QrLocation.code       — building location QR. Inspector scans
//                              to land on the correct space.
//                              Returns kind='location'.
//   3. Asset.id              — UUID-shaped tokens that resolve to an
//                              asset row (chiller, lift, …).
//                              Returns kind='asset'.
//   4. TaskInstance.id       — UUID tokens for a printed work-order
//                              ticket. Returns kind='task'.
//
// Not found → 404. Rate-limited at the controller layer (this service
// runs under tenant context, so RLS does the cross-tenant guard for
// us — but we still want public-style throttle on the endpoint
// because token brute-force enumerates valid scan targets cheaply).

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const TOKEN_RE = /^[A-Za-z0-9_-]{4,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolvedScanTarget =
  | {
      kind: 'cleaning_request_form';
      pointId: string;
      zoneId: string;
      buildingId: string;
      label: string;
      publicUrl: string;
    }
  | {
      kind: 'location';
      locationId: string;
      buildingId: string;
      code: string;
      label: string;
      targetType: string;
    }
  | {
      kind: 'asset';
      assetId: string;
      buildingId: string;
      name: string;
      class: string;
      systemFamily: string | null;
    }
  | { kind: 'task'; taskId: string; buildingId: string; title: string; status: string };

@Injectable()
export class ScannerService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: string, token: string): Promise<ResolvedScanTarget> {
    const t = (token || '').trim();
    if (!t) throw new BadRequestException('token required');
    if (!TOKEN_RE.test(t)) throw new BadRequestException('token has invalid characters');

    // 1. Cleaning QR point (publicly-scannable, short opaque code).
    const cleaningPoint = await this.prisma.cleaningQrPoint.findFirst({
      where: { tenantId, code: t, isActive: true },
      select: {
        id: true,
        zoneId: true,
        buildingId: true,
        label: true,
        publicUrl: true,
      },
    });
    if (cleaningPoint) {
      return {
        kind: 'cleaning_request_form',
        pointId: cleaningPoint.id,
        zoneId: cleaningPoint.zoneId,
        buildingId: cleaningPoint.buildingId,
        label: cleaningPoint.label,
        publicUrl: cleaningPoint.publicUrl,
      };
    }

    // 2. Location QR (building-scoped short code like BC1-LOBBY-E1).
    const location = await this.prisma.qrLocation.findFirst({
      where: { tenantId, code: t },
      select: {
        id: true,
        buildingId: true,
        code: true,
        label: true,
        targetType: true,
      },
    });
    if (location) {
      return {
        kind: 'location',
        locationId: location.id,
        buildingId: location.buildingId,
        code: location.code,
        label: location.label,
        targetType: location.targetType,
      };
    }

    // 3 + 4 require UUID-shaped tokens. Anything else can't match an
    // id field and we skip straight to the 404 — saves two DB calls.
    if (!UUID_RE.test(t)) {
      throw new NotFoundException('token did not resolve to a known scan target');
    }

    // 3. Asset (printed asset tag).
    const asset = await this.prisma.asset.findFirst({
      where: { tenantId, id: t },
      select: {
        id: true,
        buildingId: true,
        name: true,
        class: true,
        systemFamily: true,
      },
    });
    if (asset) {
      return {
        kind: 'asset',
        assetId: asset.id,
        buildingId: asset.buildingId,
        name: asset.name,
        class: asset.class,
        systemFamily: asset.systemFamily,
      };
    }

    // 4. Task (printed work-order slip).
    const task = await this.prisma.taskInstance.findFirst({
      where: { tenantId, id: t },
      select: {
        id: true,
        buildingId: true,
        title: true,
        status: true,
      },
    });
    if (task) {
      return {
        kind: 'task',
        taskId: task.id,
        buildingId: task.buildingId,
        title: task.title,
        status: task.status,
      };
    }

    throw new NotFoundException('token did not resolve to a known scan target');
  }
}
