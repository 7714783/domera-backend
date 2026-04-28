import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { OnboardingService } from './onboarding.service';

async function extractUserId(auth: string | undefined, authService: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const payload = await authService.verifySession(auth.slice(7));
  if (!payload) throw new UnauthorizedException('invalid or revoked token');
  return payload.sub;
}

@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly auth: AuthService,
  ) {}

  @Get('my-workspaces')
  async myWorkspaces(@Headers('authorization') auth?: string) {
    const userId = await extractUserId(auth, this.auth);
    return this.onboarding.myWorkspaces(userId);
  }

  @Post('workspace')
  async workspace(
    @Body() body: { name: string; slug?: string; timezone?: string; locale?: string },
    @Headers('authorization') auth?: string,
  ) {
    const userId = await extractUserId(auth, this.auth);
    return this.onboarding.createWorkspace(userId, body);
  }

  @Post('organization')
  async organization(
    @Body()
    body: {
      tenantId: string;
      name: string;
      slug?: string;
      type: 'owner' | 'management_company' | 'vendor' | 'consultant';
    },
    @Headers('authorization') auth?: string,
  ) {
    const userId = await extractUserId(auth, this.auth);
    return this.onboarding.createOrganization(userId, body);
  }

  @Post('building')
  async building(@Body() body: any, @Headers('authorization') auth?: string) {
    const userId = await extractUserId(auth, this.auth);
    return this.onboarding.createBuilding(userId, body);
  }

  @Post('bootstrap')
  async bootstrap(
    @Body()
    body: {
      buildingName: string;
      addressLine1: string;
      city: string;
      countryCode: string;
      timezone: string;
      buildingType?: any;
      workspaceName?: string;
    },
    @Headers('authorization') auth?: string,
  ) {
    const userId = await extractUserId(auth, this.auth);
    return this.onboarding.bootstrapFirstBuilding(userId, body);
  }

  @Get('buildings/:slug/full')
  async buildingFull(
    @Param('slug') slug: string,
    @Headers('authorization') auth?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
  ) {
    // Verify the token (throws UnauthorizedException on bad/missing auth)
    // even though we don't need the user id here. Must be awaited or the
    // handler runs before the check resolves.
    await extractUserId(auth, this.auth);
    const { resolveTenantId } = await import('../../common/tenant.utils');
    const tenantId = resolveTenantId(tenantIdHeader);
    return this.onboarding.buildingFull(tenantId, slug);
  }

  @Patch('buildings/:slug')
  async patchBuilding(
    @Param('slug') slug: string,
    @Body() patch: any,
    @Headers('authorization') auth?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
  ) {
    const userId = await extractUserId(auth, this.auth);
    const { resolveTenantId } = await import('../../common/tenant.utils');
    const tenantId = resolveTenantId(tenantIdHeader);
    return this.onboarding.updateBuilding(userId, tenantId, slug, patch);
  }
}
