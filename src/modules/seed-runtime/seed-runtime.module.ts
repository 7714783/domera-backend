import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SeedRuntimeController } from './seed-runtime.controller';
import { SeedRuntimeService } from './seed-runtime.service';

@Module({
  imports: [AuditModule],
  controllers: [SeedRuntimeController],
  providers: [SeedRuntimeService],
  exports: [SeedRuntimeService],
})
export class SeedRuntimeModule {}
