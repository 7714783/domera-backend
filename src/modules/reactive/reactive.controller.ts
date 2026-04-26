import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { ReactiveService } from './reactive.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller()
export class ReactiveController {
  constructor(
    private readonly reactive: ReactiveService,
    private readonly auth: AuthService,
  ) {}

  // Incidents
  @Get('buildings/:id/incidents')
  async listIncidents(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const user = ah ? await uid(ah, this.auth).catch(() => null) : null;
    return this.reactive.listIncidents(resolveTenantId(th), id, { status, severity }, user);
  }

  @Post('buildings/:id/incidents')
  async createIncident(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const user = ah ? await uid(ah, this.auth).catch(() => null) : null;
    return this.reactive.createIncident(resolveTenantId(th), user, id, body);
  }

  @Post('incidents/:id/ack')
  async ackIncident(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.reactive.ackIncident(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  @Post('incidents/:id/assign')
  async assignIncident(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.reactive.assignIncident(resolveTenantId(th), await uid(ah, this.auth), id, body);
  }

  @Post('service-requests/:id/assign')
  async assignSR(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.reactive.assignServiceRequest(
      resolveTenantId(th),
      await uid(ah, this.auth),
      id,
      body,
    );
  }

  @Post('incidents/:id/resolve')
  async resolveIncident(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.reactive.resolveIncident(resolveTenantId(th), await uid(ah, this.auth), id, body);
  }

  // Service requests
  @Get('buildings/:id/service-requests')
  async listSR(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const user = ah ? await uid(ah, this.auth).catch(() => null) : null;
    return this.reactive.listServiceRequests(resolveTenantId(th), id, { status, category }, user);
  }

  @Post('buildings/:id/service-requests')
  async createSR(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    const user = ah ? await uid(ah, this.auth).catch(() => null) : null;
    return this.reactive.createServiceRequest(resolveTenantId(th), user, id, body);
  }

  @Post('service-requests/:id/resolve')
  async resolveSR(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.reactive.resolveServiceRequest(
      resolveTenantId(th),
      await uid(ah, this.auth),
      id,
      body,
    );
  }

  // Triage queue (portfolio-wide, SLA-aware)
  @Get('triage')
  triage(
    @Query('buildingId') buildingId?: string,
    @Query('status') status?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.reactive.triageQueue(resolveTenantId(th), { buildingId, status });
  }

  // Convert → WorkOrder
  @Post('work-orders/from-intake')
  async convertToWO(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.reactive.convertToWorkOrder(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  // Quote / PO / Completion
  @Post('quotes')
  async createQuote(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.reactive.createQuote(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Post('purchase-orders')
  async issuePO(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.reactive.issuePurchaseOrder(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Post('completions')
  async recordCompletion(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.reactive.recordCompletion(resolveTenantId(th), await uid(ah, this.auth), body);
  }
}
