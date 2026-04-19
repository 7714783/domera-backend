import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { ProjectsService } from './projects.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly svc: ProjectsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(
    @Query('buildingId') buildingId?: string,
    @Query('classification') classification?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.listProjects(resolveTenantId(th), buildingId, classification);
  }

  @Get(':id')
  get(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.getProject(resolveTenantId(th), id);
  }

  @Post()
  async create(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.createProject(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Patch(':id/classify')
  async classify(
    @Param('id') id: string,
    @Body() body: { classification: string; reason?: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.classify(resolveTenantId(th), await uid(ah, this.auth), id, body);
  }

  @Patch(':id/stage')
  async advanceStage(
    @Param('id') id: string,
    @Body() body: { stage: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.advanceStage(resolveTenantId(th), await uid(ah, this.auth), id, body.stage);
  }

  // Stages
  @Post(':id/stages')
  createStage(@Param('id') id: string, @Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.createStage(resolveTenantId(th), id, body);
  }

  @Patch('stages/:stageId')
  updateStage(@Param('stageId') stageId: string, @Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.updateStage(resolveTenantId(th), stageId, body);
  }

  // Budget lines
  @Post(':id/budget-lines')
  addBudgetLine(@Param('id') id: string, @Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.addBudgetLine(resolveTenantId(th), id, body);
  }

  @Patch('budget-lines/:lineId/classify')
  async convertLine(
    @Param('lineId') lineId: string,
    @Body() body: { to: string; reason?: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.convertLineClassification(resolveTenantId(th), await uid(ah, this.auth), lineId, body.to, body.reason);
  }

  // Change orders
  @Post(':id/change-orders')
  async createCO(
    @Param('id') id: string, @Body() body: any,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.createChangeOrder(resolveTenantId(th), await uid(ah, this.auth), id, body);
  }

  @Post('change-orders/:coId/decide')
  async decideCO(
    @Param('coId') coId: string,
    @Body() body: { decision: 'approved' | 'rejected' },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.decideChangeOrder(resolveTenantId(th), await uid(ah, this.auth), coId, body.decision);
  }

  // Acceptance pack
  @Post(':id/acceptance-pack')
  upsertPack(@Param('id') id: string, @Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.upsertAcceptancePack(resolveTenantId(th), id, body);
  }

  @Post(':id/acceptance-pack/submit')
  async submitPack(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.submitAcceptancePack(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Post(':id/acceptance-pack/signoff')
  async signoffPack(
    @Param('id') id: string,
    @Body() body: { signoff: 'contractor' | 'manager' | 'chief_engineer' | 'owner' },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.signoffAcceptancePack(resolveTenantId(th), await uid(ah, this.auth), id, body.signoff);
  }

  @Post(':id/acceptance-pack/reject')
  async rejectPack(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Headers('x-tenant-id') th?: string, @Headers('authorization') ah?: string,
  ) {
    return this.svc.rejectAcceptancePack(resolveTenantId(th), await uid(ah, this.auth), id, body.reason);
  }
}
