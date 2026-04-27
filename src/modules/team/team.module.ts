import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

// @Global so PPM/Cleaning/Reactive can inject the resolver helper without
// listing TeamModule in their imports[].
@Global()
@Module({
  imports: [AuthModule],
  controllers: [TeamController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
