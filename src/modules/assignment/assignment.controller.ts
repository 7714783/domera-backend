// INIT-004 Phase 2 — REST surface for FloorAssignment + UserAvailability.

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { AuthService } from '../auth/auth.service';
import { AssignmentService } from './assignment.service';

async function uid(auth: string | undefined, s: AuthService): Promise<string> {
  if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('no token');
  const p = await s.verifySession(auth.slice(7));
  if (!p) throw new UnauthorizedException('invalid or revoked token');
  return p.sub;
}

@Controller()
export class AssignmentController {
  constructor(
    private readonly svc: AssignmentService,
    private readonly auth: AuthService,
  ) {}

  // ── Floor assignments ────────────────────────────────────
  @Get('buildings/:id/floor-assignments')
  list(
    @Param('id') id: string,
    @Query('floorId') floorId?: string,
    @Query('roleKey') roleKey?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.listFloorAssignments(resolveTenantId(th), id, { floorId, roleKey });
  }

  @Post('buildings/:id/floor-assignments')
  async create(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.createFloorAssignment(resolveTenantId(th), await uid(ah, this.auth), id, body);
  }

  @Delete('floor-assignments/:id')
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.deleteFloorAssignment(resolveTenantId(th), await uid(ah, this.auth), id);
  }

  // ── User availability ────────────────────────────────────
  @Get('user-availability')
  listAvailability(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.listAvailability(resolveTenantId(th), { userId, from, to });
  }

  @Post('user-availability')
  async setAvailability(
    @Body() body: any,
    @Headers('x-tenant-id') th?: string,
    @Headers('authorization') ah?: string,
  ) {
    return this.svc.setAvailability(resolveTenantId(th), await uid(ah, this.auth), body);
  }
}
