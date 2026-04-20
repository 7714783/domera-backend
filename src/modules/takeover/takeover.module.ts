import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BuildingsModule } from '../buildings/buildings.module';
import { TakeoverController } from './takeover.controller';
import { TakeoverService } from './takeover.service';

@Module({
  imports: [AuditModule, BuildingsModule],
  controllers: [TakeoverController],
  providers: [TakeoverService],
  exports: [TakeoverService],
})
export class TakeoverModule {}
