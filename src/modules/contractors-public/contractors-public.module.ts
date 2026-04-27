import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContractorsPublicController } from './contractors-public.controller';
import { ContractorsPublicService } from './contractors-public.service';

@Module({
  imports: [AuthModule],
  controllers: [ContractorsPublicController],
  providers: [ContractorsPublicService],
  exports: [ContractorsPublicService],
})
export class ContractorsPublicModule {}
