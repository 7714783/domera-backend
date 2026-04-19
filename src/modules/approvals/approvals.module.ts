import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { ApprovalPoliciesService } from './approval-policies.service';
import { ApprovalDelegationsService } from './approval-delegations.service';
import { ApprovalBottlenecksService } from './approval-bottlenecks.service';

@Module({
  imports: [AuthModule],
  controllers: [ApprovalsController],
  providers: [
    ApprovalsService,
    ApprovalPoliciesService,
    ApprovalDelegationsService,
    ApprovalBottlenecksService,
  ],
  exports: [
    ApprovalsService,
    ApprovalPoliciesService,
    ApprovalDelegationsService,
    ApprovalBottlenecksService,
  ],
})
export class ApprovalsModule {}
