import { Module } from '@nestjs/common';
import { SeedRuntimeController } from './seed-runtime.controller';
import { SeedRuntimeService } from './seed-runtime.service';

@Module({
  controllers: [SeedRuntimeController],
  providers: [SeedRuntimeService],
  exports: [SeedRuntimeService],
})
export class SeedRuntimeModule {}
