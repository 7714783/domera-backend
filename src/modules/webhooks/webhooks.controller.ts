import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { WebhooksService } from './webhooks.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly svc: WebhooksService,
    private readonly auth: AuthService,
  ) {}

  // Outbound subscriptions
  @Get('subscriptions')
  listSubs(@Headers('x-tenant-id') th?: string) {
    return this.svc.listSubscriptions(resolveTenantId(th));
  }

  @Post('subscriptions')
  async createSub(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.createSubscription(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Delete('subscriptions/:id')
  deleteSub(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.deleteSubscription(resolveTenantId(th), id);
  }

  // Inbound sources
  @Get('inbound')
  listInbound(@Headers('x-tenant-id') th?: string) {
    return this.svc.listInbound(resolveTenantId(th));
  }

  @Post('inbound')
  async registerInbound(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.registerInbound(resolveTenantId(th), await uid(ah, this.auth), body);
  }

  @Get('inbound/events')
  inboundEvents(
    @Query('channel') channel?: string,
    @Query('take') take?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.listInboundEvents(resolveTenantId(th), {
      channel,
      take: take ? Number(take) : undefined,
    });
  }

  // Inbound receiver — public, auth via HMAC signature
  @Post('inbound/:channel')
  async ingest(
    @Param('channel') channel: string,
    @Req() req: Request,
    @Headers('x-tenant-id') th?: string,
  ) {
    const tenantId = resolveTenantId(th);
    const raw: Buffer | undefined = (req as any).rawBody;
    if (!raw)
      throw new BadRequestException('rawBody required — ensure rawBody middleware is configured');
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v || '');
    }
    return this.svc.ingestInbound(tenantId, channel, headers, raw.toString('utf8'));
  }
}
