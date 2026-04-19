import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MigratorPrismaService } from './prisma.migrator';

@Global()
@Module({
  providers: [PrismaService, MigratorPrismaService],
  exports: [PrismaService, MigratorPrismaService],
})
export class PrismaModule {}
