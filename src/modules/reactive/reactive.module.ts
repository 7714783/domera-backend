import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReactiveController } from './reactive.controller';
import { ReactiveService } from './reactive.service';

@Module({
  imports: [AuthModule],
  controllers: [ReactiveController],
  providers: [ReactiveService],
  exports: [ReactiveService],
})
export class ReactiveModule {}
