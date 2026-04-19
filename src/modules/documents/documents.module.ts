import { Module } from '@nestjs/common';
import * as path from 'node:path';
import { AuthModule } from '../auth/auth.module';
import { DocumentsController, DocumentsSignedController } from './documents.controller';
import { DocumentsService, OBJECT_STORAGE } from './documents.service';
import { LocalDiskStorage } from './storage';

const DEFAULT_ROOT = path.resolve(process.cwd(), 'apps/api/.data/documents');

@Module({
  imports: [AuthModule],
  controllers: [DocumentsController, DocumentsSignedController],
  providers: [
    DocumentsService,
    {
      provide: OBJECT_STORAGE,
      useFactory: () => new LocalDiskStorage(process.env.OBJECT_STORAGE_ROOT || DEFAULT_ROOT),
    },
  ],
  exports: [DocumentsService, OBJECT_STORAGE],
})
export class DocumentsModule {}
