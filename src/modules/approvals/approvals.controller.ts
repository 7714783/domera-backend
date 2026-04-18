import { Controller, Get, Headers, NotFoundException, Param, Post } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get()
  async list(@Headers('x-tenant-id') tenantIdHeader?: string) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const items = await this.approvalsService.list(tenantId);

    return {
      tenantId,
      summary: this.approvalsService.summary(items),
      items,
    };
  }

  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-actor-role') actorRoleHeader?: string,
    @Headers('x-actor-user-id') actorUserIdHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const item = await this.approvalsService.approve(
      tenantId,
      id,
      actorRoleHeader || 'finance_controller',
      actorUserIdHeader || 'System Operator',
    );

    if (!item) {
      throw new NotFoundException('Approval not found');
    }

    return item;
  }
}
