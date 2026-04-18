import { Controller, Get, Headers } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(@Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const items = await this.auditService.list(tenantId);

    return {
      tenantId,
      total: items.length,
      items,
    };
  }
}
