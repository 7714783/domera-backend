import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { ApprovalsService } from './approvals.service';
import { ApprovalPoliciesService } from './approval-policies.service';
import { ApprovalDelegationsService } from './approval-delegations.service';
import { ApprovalBottlenecksService } from './approval-bottlenecks.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly policiesService: ApprovalPoliciesService,
    private readonly delegationsService: ApprovalDelegationsService,
    private readonly bottlenecksService: ApprovalBottlenecksService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') ah?: string,
  ) {
    await uid(ah, this.auth);
    const tenantId = resolveTenantId(tenantIdHeader);
    const items = await this.approvalsService.list(tenantId);
    return { tenantId, summary: this.approvalsService.summary(items), items };
  }

  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') ah?: string,
    // Header retained as an OPT-IN override for testing/migration, but it
    // NEVER bypasses authentication — the actual user is always derived from
    // the bearer token. Default role changed from a privileged constant to a
    // neutral one; real role comes from the user's memberships in the service.
    @Headers('x-actor-role') actorRoleHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const actorUserId = await uid(ah, this.auth);
    const item = await this.approvalsService.approve(
      tenantId,
      id,
      actorRoleHeader || 'member',
      actorUserId,
    );
    if (!item) throw new NotFoundException('Approval not found');
    return item;
  }

  // ─── Policies ─────────────────────────────────────────────────
  @Get('policies')
  listPolicies(
    @Query('type') type?: string,
    @Query('buildingId') buildingId?: string,
    @Query('includeInactive') includeInactive?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.policiesService.list(resolveTenantId(th), {
      type,
      buildingId,
      includeInactive: includeInactive === 'true' || includeInactive === '1',
    });
  }

  @Post('policies')
  async createPolicy(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.policiesService.create(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Get('policies/:id/history')
  history(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.policiesService.history(resolveTenantId(th), id);
  }

  @Post('policies/:id/supersede')
  async supersedePolicy(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.policiesService.supersede(resolveTenantId(th), await uid(ah, this.auth), id, body);
  }

  @Delete('policies/:id')
  async deactivatePolicy(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.policiesService.deactivate(resolveTenantId(th), id);
  }

  @Post('policies/resolve')
  resolvePolicy(
    @Body() body: { type: string; buildingId?: string | null; amount: number },
    @Headers('x-tenant-id') th?: string,
  ) {
    if (!body?.type || typeof body?.amount !== 'number')
      throw new BadRequestException('type + amount required');
    return this.policiesService.resolveActive(resolveTenantId(th), body);
  }

  // ─── Delegations ──────────────────────────────────────────────
  @Get('delegations')
  listDelegations(
    @Query('delegateUserId') delegateUserId?: string,
    @Query('delegatorUserId') delegatorUserId?: string,
    @Query('activeOnly') activeOnly?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.delegationsService.list(resolveTenantId(th), {
      delegateUserId,
      delegatorUserId,
      activeOnly: activeOnly === 'true' || activeOnly === '1',
    });
  }

  @Post('delegations')
  async createDelegation(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.delegationsService.create(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Post('delegations/:id/revoke')
  async revokeDelegation(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.delegationsService.revoke(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  // ─── Bottlenecks ──────────────────────────────────────────────
  @Get('bottlenecks')
  bottlenecks(
    @Query('buildingId') buildingId?: string,
    @Query('slaHours') slaHours?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.bottlenecksService.snapshot(resolveTenantId(th), {
      buildingId,
      defaultSlaHours: slaHours ? Math.max(1, Number(slaHours)) : undefined,
    });
  }
}
