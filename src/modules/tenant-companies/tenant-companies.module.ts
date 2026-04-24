import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TenantCompaniesController } from './tenant-companies.controller';
import { TenantCompaniesService } from './tenant-companies.service';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [TenantCompaniesController],
  providers: [TenantCompaniesService],
  exports: [TenantCompaniesService],
})
export class TenantCompaniesModule {}
