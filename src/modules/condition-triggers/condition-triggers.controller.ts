import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { ConditionTriggersService } from './condition-triggers.service';

@Controller('condition-triggers')
export class ConditionTriggersController {
  constructor(private readonly svc: ConditionTriggersService) {}

  @Get()
  list(@Query('buildingId') buildingId?: string, @Headers('x-tenant-id') th?: string) {
    return this.svc.list(resolveTenantId(th), buildingId);
  }

  @Post()
  create(@Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.create(resolveTenantId(th), body);
  }

  @Post('evaluate')
  evaluate(@Body() body: any, @Headers('x-tenant-id') th?: string) {
    return this.svc.evaluateReading(resolveTenantId(th), body);
  }

  @Get('events')
  events(
    @Query('triggerId') triggerId?: string,
    @Query('sensorPointId') sensorPointId?: string,
    @Query('action') action?: string,
    @Query('take') take?: string,
    @Headers('x-tenant-id') th?: string,
  ) {
    return this.svc.listEvents(resolveTenantId(th), { triggerId, sensorPointId, action, take: take ? Number(take) : undefined });
  }
}
