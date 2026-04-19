import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScimController } from './scim.controller';
import { ScimService } from './scim.service';

@Module({
  imports: [AuthModule],
  controllers: [ScimController],
  providers: [ScimService],
  exports: [ScimService],
})
export class ScimModule {}
