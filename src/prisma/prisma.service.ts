import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantContext } from '../common/tenant-context';

export type TenantScopedTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[a-z0-9_-]+$/i;

function isSafeTenantId(id: string): boolean {
  return UUID_RE.test(id) || SAFE_ID_RE.test(id);
}

/**
 * PrismaService wraps PrismaClient and transparently sets
 * `app.current_tenant_id` for each tenant-scoped operation via an auto-wrapping
 * transaction, so RLS policies evaluate against the current ALS tenant. When
 * ALS has no tenant (seeds, workers, unauthenticated paths) queries fall
 * through unmodified — use a migrator-role DATABASE_URL for those contexts or
 * explicitly call `withTenant()`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PrismaRls');
  private _extended!: ReturnType<PrismaClient['$extends']>;

  constructor() {
    super();
    this._extended = (this as PrismaClient).$extends({
      name: 'tenant-rls-wrap',
      query: {
        $allOperations: async ({ args, query, operation, model }) => {
          const tenantId = TenantContext.getTenantId();
          if (!tenantId) return query(args);
          if (!isSafeTenantId(tenantId)) throw new Error(`unsafe tenantId: ${tenantId}`);

          const self = this as unknown as PrismaClient;
          return self.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              `select set_config('app.current_tenant_id', '${tenantId}', true)`,
            );
            if (model) {
              const delegateKey = model.charAt(0).toLowerCase() + model.slice(1);
              return (tx as any)[delegateKey][operation](args);
            }
            if (operation === '$queryRaw' || operation === '$executeRaw') {
              return (tx as any)[operation](...(Array.isArray(args) ? args : [args]));
            }
            if (operation === '$queryRawUnsafe' || operation === '$executeRawUnsafe') {
              const arr = Array.isArray(args) ? args : [args];
              return (tx as any)[operation](...arr);
            }
            return query(args);
          });
        },
      },
    });

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && prop in target._extended && !['$connect', '$disconnect', '$use', '$on'].includes(prop)) {
          const v = (target._extended as any)[prop];
          return typeof v === 'function' ? v.bind(target._extended) : v;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.log.log('RLS auto-wrap active (tenant-aware $extends; set_config per tenant-scoped request)');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async withTenant<T>(tenantId: string, fn: (tx: TenantScopedTx) => Promise<T>): Promise<T> {
    if (!tenantId) throw new Error('withTenant: tenantId is required');
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(tx as unknown as TenantScopedTx);
    });
  }
}

export { Prisma };
