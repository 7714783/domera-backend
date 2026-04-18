import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type TenantScopedTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Run work inside a transaction with `app.current_tenant_id` set via
   * set_config(..., true), so RLS policies evaluate against the tenant.
   * Transaction-local: the setting is discarded on commit/rollback.
   */
  async withTenant<T>(tenantId: string, fn: (tx: TenantScopedTx) => Promise<T>): Promise<T> {
    if (!tenantId) {
      throw new Error('withTenant: tenantId is required');
    }

    return this.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(tx as unknown as TenantScopedTx);
    });
  }
}

export { Prisma };
