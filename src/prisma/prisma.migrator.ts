import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * MigratorPrismaService — a second Prisma client connected as `domera_migrator`
 * (BYPASSRLS). Used ONLY for cross-tenant lookups that happen before the
 * tenant id is known, such as resolving a public QR code. Never inject this
 * into request-scoped services; use it from controllers gated to public paths.
 */
@Injectable()
export class MigratorPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: process.env.DATABASE_URL_MIGRATOR || process.env.DATABASE_URL },
      },
    });
  }
  async onModuleInit() {
    // NS-25 — see PrismaService.onModuleInit; OPENAPI_GEN_MODE skips
    // $connect so the spec gen does not require a live Postgres.
    if (process.env.OPENAPI_GEN_MODE === '1') return;
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
