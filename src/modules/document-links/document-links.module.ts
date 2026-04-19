import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentLinksController } from './document-links.controller';
import { DocumentLinksService } from './document-links.service';

@Module({
  imports: [AuthModule],
  controllers: [DocumentLinksController],
  providers: [DocumentLinksService],
  exports: [DocumentLinksService],
})
export class DocumentLinksModule {}
