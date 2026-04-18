import { Body, Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { PpmService } from './ppm.service';

function uid(auth: string | undefined, s: AuthService): string {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = s.verify(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid token');
  return p.sub;
}

@Controller()
export class PpmController {
  constructor(
    private readonly ppm: PpmService,
    private readonly auth: AuthService,
  ) {}

  @Get('buildings/:id/ppm/programs')
  listPrograms(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.ppm.listPrograms(resolveTenantId(th), id);
  }

  @Post('buildings/:id/ppm/programs')
  createProgram(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.createProgram(resolveTenantId(th), uid(ah, this.auth), id, body);
  }

  @Get('buildings/:id/ppm/executions')
  listExecutions(
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
  calendar(@Param('id') id: string, @Query('days') days?: string, @Headers('x-tenant-id') th?: string) {
    return this.ppm.calendar(resolveTenantId(th), id, days ? Number(days) : 90);
  }

  @Post('ppm/plan-items/:planItemId/schedule')
  schedule(
    @Param('planItemId') planItemId: string, @Body() body: { targetDate?: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.scheduleExecution(resolveTenantId(th), uid(ah, this.auth), planItemId, body?.targetDate);
  }

  @Get('buildings/:id/ppm/wizard/catalog')
  wizardCatalog(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.ppm.wizardCatalog(resolveTenantId(th), id);
  }

  @Post('buildings/:id/ppm/wizard/apply')
  wizardApply(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.wizardApply(resolveTenantId(th), uid(ah, this.auth), id, body || { items: [] });
  }

  @Get('ppm/executions/:id')
  getExecution(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.ppm.getExecution(resolveTenantId(th), id);
  }

  @Post('ppm/executions/:id/request-quote')
  requestQuote(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.requestQuote(resolveTenantId(th), uid(ah, this.auth), id, body || {});
  }

  @Post('ppm/executions/:id/record-quote')
  recordQuote(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.recordQuote(resolveTenantId(th), uid(ah, this.auth), id, body || {});
  }

  @Post('ppm/executions/:id/submit-for-approval')
  submit(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.submitForApproval(resolveTenantId(th), uid(ah, this.auth), id);
  }

  @Post('ppm/executions/:id/mark-approved')
  markApproved(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.markApproved(resolveTenantId(th), uid(ah, this.auth), id);
  }

  @Post('ppm/executions/:id/place-order')
  place(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.placeOrder(resolveTenantId(th), uid(ah, this.auth), id);
  }

  @Post('ppm/executions/:id/mark-in-progress')
  inProgress(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.markInProgress(resolveTenantId(th), uid(ah, this.auth), id);
  }

  @Post('ppm/executions/:id/record-completion')
  complete(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.recordCompletion(resolveTenantId(th), uid(ah, this.auth), id, body || {});
  }

  @Post('ppm/executions/:id/distribute-evidence')
  distribute(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.distributeEvidence(resolveTenantId(th), uid(ah, this.auth), id, body || { recipients: [] });
  }

  @Post('ppm/executions/:id/archive')
  archive(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.archive(resolveTenantId(th), uid(ah, this.auth), id);
  }

  @Post('ppm/executions/:id/cancel')
  cancel(
    @Param('id') id: string, @Body() body: { reason?: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.ppm.cancel(resolveTenantId(th), uid(ah, this.auth), id, body?.reason);
  }
}
