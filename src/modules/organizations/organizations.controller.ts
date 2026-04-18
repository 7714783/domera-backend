import { Controller, Get, Headers } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  async list(@Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const items = await this.organizationsService.list(tenantId);

    return {
      tenantId,
      total: items.length,
      items,
    };
  }
}
