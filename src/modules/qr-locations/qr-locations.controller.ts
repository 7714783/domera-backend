import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveTenantId } from '../../common/tenant.utils';
import { PublicQrService } from '../public-qr/public-qr.service';
import { QrLocationsService } from './qr-locations.service';

@Controller()
export class QrLocationsController {
  constructor(
    private readonly qr: QrLocationsService,
    private readonly pub: PublicQrService,
  ) {}

  @Get('buildings/:id/qr-locations/print-sheet')
  async printSheet(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-tenant-id') th?: string,
    @Query('base') base?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const { items } = await this.qr.list(tenantId, id);
    const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
    const host =
      (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
    const baseUrl = (base || process.env.APP_PUBLIC_BASE_URL || `${proto}://${host}`).replace(
      /\/$/,
      '',
    );
    const cards = await Promise.all(
      items.map(async (q: any) => {
        const { dataUrl } = await this.pub.qrPngDataUrl(q.id, baseUrl);
        return {
          id: q.id,
          code: q.code,
          label: q.label,
          targetType: q.targetType,
          dataUrl,
          scanUrl: `${baseUrl}/qr/${q.id}`,
        };
      }),
    );
    const html = renderPrintSheet(cards, baseUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('buildings/:id/qr-locations')
  list(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.qr.list(resolveTenantId(th), id);
  }

  @Post('buildings/:id/qr-locations')
  create(@Param('id') id: string, @Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.qr.create(resolveTenantId(th), id, body);
  }

  @Get('buildings/:id/qr-locations/:code')
  resolve(
    @Param('id') id: string,
    @Param('code') code: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.qr.resolveScan(resolveTenantId(th), id, code);
  }

  @Delete('buildings/:id/qr-locations/:code')
  remove(
    @Param('id') id: string,
    @Param('code') code: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.qr.delete(resolveTenantId(th), id, code);
  }
}

function escape(s: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(s ?? '').replace(/[&<>"']/g, (c) => entities[c] ?? c);
}

function renderPrintSheet(
  cards: Array<{
    id: string;
    code: string;
    label: string;
    targetType: string;
    dataUrl: string;
    scanUrl: string;
  }>,
  baseUrl: string,
): string {
  const grid = cards
    .map(
      (c) => `
    <div class="card">
      <img src="${c.dataUrl}" width="240" height="240" alt="QR ${escape(c.code)}" />
      <div class="code">${escape(c.code)}</div>
      <div class="label">${escape(c.label)}</div>
      <div class="meta">${escape(c.targetType)} · ${escape(c.scanUrl)}</div>
    </div>`,
    )
    .join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>QR print sheet</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 16mm; color: #111827; }
  .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12mm; }
  .card { border: 1px dashed #9ca3af; border-radius: 8px; padding: 8mm; text-align: center; page-break-inside: avoid; }
  .card img { display: block; margin: 0 auto 4mm; }
  .code { font-size: 14pt; font-weight: 700; letter-spacing: 0.04em; }
  .label { font-size: 11pt; margin-top: 2mm; color: #374151; }
  .meta { font-size: 8pt; color: #6b7280; margin-top: 2mm; word-break: break-all; }
  @media print { body { margin: 10mm; } .sheet { gap: 8mm; } }
</style></head><body>
  <h1 style="font-size:14pt;margin:0 0 6mm;">QR scan sheet — ${cards.length} labels</h1>
  <p style="font-size:9pt;color:#6b7280;margin:0 0 8mm;">Base URL: ${escape(baseUrl)}</p>
  <div class="sheet">${grid}</div>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));</script>
</body></html>`;
}
