import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmergencyOverridesController } from './emergency-overrides.controller';
import { EmergencyOverridesService } from './emergency-overrides.service';

@Module({
  imports: [AuthModule],
  controllers: [EmergencyOverridesController],
  providers: [EmergencyOverridesService],
  exports: [EmergencyOverridesService],
})
export class EmergencyOverridesModule {}
