import { Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { PpmService } from './ppm.service';
import { PrismaService } from '../../prisma/prisma.service';
import { scanAndSendReminders } from './sla-reminder.worker';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller()
export class PpmController {
  constructor(
    private readonly ppm: PpmService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('ppm/sla/scan-now')
  async slaScanNow(@Headers('authorization') ah?: string) {
    await uid(ah, this.auth); // auth required but result is tenant-agnostic administrative
    return scanAndSendReminders(this.prisma as any);
  }

  @Get('buildings/:id/ppm/programs')
  async listPrograms(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.ppm.listPrograms(resolveTenantId(th), id);
  }

  @Post('buildings/:id/ppm/programs')
  async createProgram(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.createProgram(resolveTenantId(th), await uid(ah, this.auth), id, body);
  }

  @Get('buildings/:id/ppm/executions')
  async listExecutions(
    @Param('id') id: string,
    @Query('stage') stage?: string,
    @Query('scope') scope?: string,
    @Query('limit') limit?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.ppm.listExecutions(resolveTenantId(th), id, {
      stage: stage || undefined, scope: scope || undefined, limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('buildings/:id/ppm/calendar')
  async calendar(@Param('id') id: string, @Query('days') days?: string, @Headers('x-tenant-id') th?: string) {
    return this.ppm.calendar(resolveTenantId(th), id, days ? Number(days) : 90);
  }

  @Post('ppm/plan-items/:planItemId/schedule')
  async schedule(
    @Param('planItemId') planItemId: string, @Body() body: { targetDate?: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.scheduleExecution(resolveTenantId(th), await uid(ah, this.auth), planItemId, body?.targetDate);
  }

  @Get('buildings/:id/ppm/wizard/catalog')
  async wizardCatalog(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.ppm.wizardCatalog(resolveTenantId(th), id);
  }

  @Post('buildings/:id/ppm/wizard/apply')
  async wizardApply(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.wizardApply(resolveTenantId(th), await uid(ah, this.auth), id, body || { items: [] });
  }

  @Get('ppm/executions/:id')
  async getExecution(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.ppm.getExecution(resolveTenantId(th), id);
  }

  @Post('ppm/executions/:id/request-quote')
  async requestQuote(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.requestQuote(resolveTenantId(th), await uid(ah, this.auth), id, body || {});
  }

  @Post('ppm/executions/:id/record-quote')
  async recordQuote(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.recordQuote(resolveTenantId(th), await uid(ah, this.auth), id, body || {});
  }

  @Post('ppm/executions/:id/submit-for-approval')
  async submit(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.submitForApproval(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Post('ppm/executions/:id/mark-approved')
  async markApproved(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.markApproved(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Post('ppm/executions/:id/place-order')
  async place(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.placeOrder(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Post('ppm/executions/:id/mark-in-progress')
  async inProgress(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.markInProgress(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Post('ppm/executions/:id/record-completion')
  async complete(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.recordCompletion(resolveTenantId(th), await uid(ah, this.auth), id, body || {});
  }

  @Post('ppm/executions/:id/review-completion')
  async reviewCompletion(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.reviewCompletion(resolveTenantId(th), await uid(ah, this.auth), id, body || {});
  }

  @Post('ppm/executions/:id/distribute-evidence')
  async distribute(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.distributeEvidence(resolveTenantId(th), await uid(ah, this.auth), id, body || { recipients: [] });
  }

  @Post('ppm/executions/:id/archive')
  async archive(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.archive(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Post('ppm/executions/:id/cancel')
  async cancel(
    @Param('id') id: string, @Body() body: { reason?: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.cancel(resolveTenantId(th), await uid(ah, this.auth), id, body?.reason);
  }
}
