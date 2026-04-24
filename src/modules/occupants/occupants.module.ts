import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { OccupantsController, OccupantsPortfolioController } from './occupants.controller';
import { OccupantsService } from './occupants.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [OccupantsPortfolioController, OccupantsController],
  providers: [OccupantsService],
  exports: [OccupantsService],
})
export class OccupantsModule {}
