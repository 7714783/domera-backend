import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoleDashboardsController } from './role-dashboards.controller';
import { RoleDashboardsService } from './role-dashboards.service';

@Module({
  imports: [AuthModule],
  controllers: [RoleDashboardsController],
  providers: [RoleDashboardsService],
  exports: [RoleDashboardsService],
})
export class RoleDashboardsModule {}
