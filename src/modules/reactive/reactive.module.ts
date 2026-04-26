import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssignmentModule } from '../assignment/assignment.module';
import { IamModule } from '../iam/iam.module';
import { AuditModule } from '../audit/audit.module';
import { ReactiveController } from './reactive.controller';
import { ReactiveService } from './reactive.service';

@Module({
  imports: [AuthModule, AssignmentModule, IamModule, AuditModule],
  controllers: [ReactiveController],
  providers: [ReactiveService],
  exports: [ReactiveService],
})
export class ReactiveModule {}
