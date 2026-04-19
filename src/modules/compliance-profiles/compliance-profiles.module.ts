import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ComplianceProfilesController } from './compliance-profiles.controller';
import { ComplianceProfilesService } from './compliance-profiles.service';

@Module({
  imports: [AuthModule],
  controllers: [ComplianceProfilesController],
  providers: [ComplianceProfilesService],
  exports: [ComplianceProfilesService],
})
export class ComplianceProfilesModule {}
