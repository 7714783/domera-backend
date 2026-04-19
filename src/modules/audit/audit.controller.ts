import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(@Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const items = await this.auditService.list(tenantId);
    return { tenantId, total: items.length, items };
  }

  @Get('search')
  async search(
    @Query('q') q?: string,
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('sensitiveOnly') sensitive?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.auditService.search(resolveTenantId(th), {
      q, actor, action, entityType,
      sensitiveOnly: sensitive === '1' || sensitive === 'true',
      from, to,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get('export.csv')
  async exportCsv(
    @Res() res: Response,
    @Query('q') q?: string,
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('sensitiveOnly') sensitive?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    const csv = await this.auditService.exportCsv(resolveTenantId(th), {
      q, actor, action, entityType,
      sensitiveOnly: sensitive === '1' || sensitive === 'true',
      from, to,
    });
    const filename = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
