import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Tenant } from '../../common/tenant.decorator';
import { CalendarBlackoutsService } from './calendar-blackouts.service';

@Controller('calendar-blackouts')
export class CalendarBlackoutsController {
  constructor(private readonly svc: CalendarBlackoutsService) {}

  @Get()
  list(@Tenant() tenantId: string, @Query('buildingId') buildingId?: string) {
    return this.svc.list(tenantId, buildingId);
  }

  @Post()
  create(@Tenant() tenantId: string, @Body() body: any) {
    return this.svc.create(tenantId, body);
  }

  @Post('seed-israel-defaults')
  seedIL(@Tenant() tenantId: string, @Body() body?: { buildingId?: string }) {
    return this.svc.seedIsraelDefaults(tenantId, body?.buildingId);
  }

  @Delete(':id')
  del(@Tenant() tenantId: string, @Param('id') id: string) {
    return this.svc.delete(tenantId, id);
  }
}
