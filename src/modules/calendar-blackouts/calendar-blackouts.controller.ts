import { Body, Controller, Delete, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { CalendarBlackoutsService } from './calendar-blackouts.service';

@Controller('calendar-blackouts')
export class CalendarBlackoutsController {
  constructor(private readonly svc: CalendarBlackoutsService) {}

  @Get()
  list(
    @Query('buildingId') buildingId?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.list(resolveTenantId(th), buildingId);
  }

  @Post()
  create(@Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.create(resolveTenantId(th), body);
  }

  @Post('seed-israel-defaults')
  seedIL(@Body() body: { buildingId?: string } | undefined, @Headers('x-tenant-id') th?: string) {
    return this.svc.seedIsraelDefaults(resolveTenantId(th), body?.buildingId);
  }

  @Delete(':id')
  del(@Param('id') id: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.delete(resolveTenantId(th), id);
  }
}
