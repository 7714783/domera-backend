import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Tenant } from '../../common/tenant.decorator';
import { CalendarBlackoutsService } from './calendar-blackouts.service';

@Controller('calendar-blackouts')
export class CalendarBlackoutsController {
  constructor(private readonly svc: CalendarBlackoutsService) {}

  @Get()
  list(@Query('buildingId') buildingId?: string, @Tenant() tenantId?: string) {
    return this.svc.list(tenantId!, buildingId);
  }

  @Post()
  create(@Body() body: any, @Tenant() tenantId?: string) {
    return this.svc.create(tenantId!, body);
  }

  @Post('seed-israel-defaults')
  seedIL(@Body() body: { buildingId?: string } | undefined, @Tenant() tenantId?: string) {
    return this.svc.seedIsraelDefaults(tenantId!, body?.buildingId);
  }

  @Delete(':id')
  del(@Param('id') id: string, @Tenant() tenantId?: string) {
    return this.svc.delete(tenantId!, id);
  }
}
