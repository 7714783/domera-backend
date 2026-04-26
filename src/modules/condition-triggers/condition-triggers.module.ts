import { Module } from '@nestjs/common';
import { PpmModule } from '../ppm/ppm.module';
import { ConditionTriggersController } from './condition-triggers.controller';
import { ConditionTriggersService } from './condition-triggers.service';

@Module({
  imports: [PpmModule],
  controllers: [ConditionTriggersController],
  providers: [ConditionTriggersService],
  exports: [ConditionTriggersService],
})
export class ConditionTriggersModule {}
