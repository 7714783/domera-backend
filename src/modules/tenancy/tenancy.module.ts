import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

// AuditModule is @Global so AuditService injects without import.
// MigratorPrismaService comes through the global PrismaModule.
@Module({
  imports: [AuthModule],
  controllers: [TenancyController],
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule {}
