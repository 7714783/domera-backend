import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContractorsWorkspaceController } from './contractors-workspace.controller';
import { ContractorsWorkspaceService } from './contractors-workspace.service';

@Module({
  imports: [AuthModule],
  controllers: [ContractorsWorkspaceController],
  providers: [ContractorsWorkspaceService],
  exports: [ContractorsWorkspaceService],
})
export class ContractorsWorkspaceModule {}
