import { Controller, Get, Headers } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { ComplianceService } from './compliance.service';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('dashboard')
  async dashboard(@Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);

    return {
      tenantId,
      ...(await this.complianceService.getDashboard(tenantId)),
    };
  }
}
