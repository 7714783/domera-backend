import { Module } from '@nestjs/common';
import { ConditionTriggersController } from './condition-triggers.controller';
import { ConditionTriggersService } from './condition-triggers.service';

@Module({
  controllers: [ConditionTriggersController],
  providers: [ConditionTriggersService],
  exports: [ConditionTriggersService],
})
export class ConditionTriggersModule {}
