import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { SeedRuntimeService } from './seed-runtime.service';

@Controller()
export class SeedRuntimeController {
  constructor(private readonly seedRuntimeService: SeedRuntimeService) {}

  @Get('workspaces/:slug')
  workspace(@Param('slug') slug: string) {
    return this.seedRuntimeService.getWorkspaceBySlug(slug);
  }

  @Get('buildings/:slug/overview')
  buildingOverview(@Param('slug') slug: string) {
    return this.seedRuntimeService.getBuildingOverview(slug);
  }

  @Get('buildings/:slug/assets/tree')
  buildingAssetsTree(@Param('slug') slug: string) {
    return this.seedRuntimeService.getAssetsTree(slug);
  }

  @Get('buildings/:slug/compliance-dashboard')
  buildingComplianceDashboard(@Param('slug') slug: string) {
    return this.seedRuntimeService.getBuildingComplianceDashboard(slug);
  }

  @Get('buildings/:slug/budgets')
  buildingBudgets(@Param('slug') slug: string) {
    return this.seedRuntimeService.getBuildingBudgets(slug);
  }

  @Get('buildings/:slug/approvals')
  buildingApprovals(@Param('slug') slug: string) {
    return this.seedRuntimeService.getBuildingApprovals(slug);
  }

  @Get('buildings/:slug/documents')
  buildingDocuments(@Param('slug') slug: string) {
    return this.seedRuntimeService.getBuildingDocuments(slug);
  }

  @Get('buildings/:slug/audit')
  buildingAudit(@Param('slug') slug: string) {
    return this.seedRuntimeService.getBuildingAudit(slug);
  }

  @Post('tasks/:id/complete')
  completeTask(
    @Param('id') taskId: string,
    @Body() body: any,
    @Headers('x-actor-user-id') actorUserIdHeader?: string,
  ) {
    const actorUserId = actorUserIdHeader || 'usr_actor_demo';
    return this.seedRuntimeService.completeTask(taskId, body, actorUserId);
  }
}
