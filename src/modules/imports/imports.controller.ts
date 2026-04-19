import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { ImportsService } from './imports.service';

@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('ppm-xlsx/preview')
  async preview(
    @Req() req: any,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-actor-user-id') actorHeader?: string,
    @Headers('x-filename') filenameHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actor = actorHeader || 'system';
    const buf: Buffer | undefined = req.rawBody || (await readStream(req));
    if (!buf || buf.length < 100) {
      throw new BadRequestException('empty or too small xlsx body');
    }
    const filename = filenameHeader || 'upload.xlsx';
    return this.importsService.preview(tenantId, actor, filename, buf);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.importsService.getJob(id);
  }

  @Post(':id/commit')
  async commit(
    @Param('id') id: string,
    @Body() body: { occurredAt?: string } | undefined,
    @Headers('x-tenant-id') tenantIdHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    return this.importsService.commit(tenantId, id, body?.occurredAt);
  }

  @Post(':id/rollback')
  async rollback(
    @Param('id') id: string,
    @Body() body: { reason?: string } | undefined,
    @Headers('x-tenant-id') tenantIdHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    return this.importsService.rollback(tenantId, id, body?.reason);
  }

  @Post('pdf-bundle/preview')
  async pdfBundlePreview(
    @Body() body: any,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-actor-user-id') actorHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    return this.importsService.pdfBundlePreview(tenantId, actorHeader || 'system', body);
  }

  @Post('pdf-bundle/:id/commit')
  async pdfBundleCommit(
    @Param('id') id: string,
    @Body() body: { occurredAt?: string } | undefined,
    @Headers('x-tenant-id') tenantIdHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    return this.importsService.pdfBundleCommit(tenantId, id, body?.occurredAt);
  }
}

function readStream(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
