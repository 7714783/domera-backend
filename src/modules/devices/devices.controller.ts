import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { DevicesService, RegisterDeviceBody } from './devices.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly auth: AuthService,
  ) {}

  /** Mobile clients call this post-login to register their push token. */
  @Post()
  async register(
    @Body() body: RegisterDeviceBody,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const userId = await uid(authHeader, this.auth);
    return this.devices.register(tenantId, userId, body);
  }

  /** List the caller's registered devices (for a session-management screen). */
  @Get()
  async list(
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const userId = await uid(authHeader, this.auth);
    const items = await this.devices.list(tenantId, userId);
    return { total: items.length, items };
  }

  /** Unregister on logout or when a device is revoked. */
  @Delete(':id')
  async unregister(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const tenantId = resolveTenantId(tenantIdHeader);
    const userId = await uid(authHeader, this.auth);
    return this.devices.unregister(tenantId, userId, id);
  }
}
