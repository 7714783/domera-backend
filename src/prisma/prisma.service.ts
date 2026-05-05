import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantContext } from '../common/tenant-context';
import { PrismaQueryStats, recordQueryTiming } from './prisma-query-stats';

export type TenantScopedTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

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
          // PERF-001 Stage 1 — record duration regardless of whether
          // the query goes through the RLS transaction or the no-tenant
          // pass-through. Wraps the awaited promise so failures still
          // count toward total query time.
          const startNs = process.hrtime.bigint();
          const observe = () => {
            const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
            recordQueryTiming(model || '_raw', operation, ms);
          };

          const tenantId = TenantContext.getTenantId();
          if (!tenantId) {
            try {
              return await query(args);
            } finally {
              observe();
            }
          }
          if (!isSafeTenantId(tenantId)) throw new Error(`unsafe tenantId: ${tenantId}`);

          const self = this as unknown as PrismaClient;
          try {
            return await self.$transaction(async (tx) => {
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
          } finally {
            observe();
          }
        },
      },
    });

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (
          typeof prop === 'string' &&
          prop in target._extended &&
          !['$connect', '$disconnect', '$use', '$on'].includes(prop)
        ) {
          const v = (target._extended as any)[prop];
          return typeof v === 'function' ? v.bind(target._extended) : v;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  async onModuleInit() {
    // NS-25 — OpenAPI spec generation creates an application context
    // purely to enumerate controllers. It never queries the DB, so we
    // skip $connect() in that mode to avoid requiring a live Postgres
    // (and a postgres service container) in the openapi-diff CI gate.
    // Any code path that DID try to query Prisma in spec-gen mode
    // would surface a clean "client not connected" error rather than
    // pretend to work.
    if (process.env.OPENAPI_GEN_MODE === '1') {
      this.log.log('OPENAPI_GEN_MODE=1 — skipping Prisma $connect()');
      return;
    }
    await this.$connect();
    this.log.log(
      'RLS auto-wrap active (tenant-aware $extends; set_config per tenant-scoped request)',
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // PERF-001 Stage 2 — batched tenant-scoped reads.
  //
  // Collapses N RLS transactions (each with its own set_config) into 1.
  // Use this on hot endpoints whose handler issues ≥3 prisma reads in
  // the same request — task inbox, role dashboards, building summary,
  // compliance dashboard. The closure receives the raw transactional
  // client, NOT the auto-wrapped extension, so it bypasses the
  // per-call $allOperations hook (no inner timing emission).
  //
  // To keep PERF-001 observability honest the whole withTenant block
  // emits ONE prisma_query_duration_ms_total observation under the
  // synthetic model name "_withTenant" — so /metrics still shows the
  // DB cost of these batched endpoints, just at a coarser grain. Tag
  // (the second arg) names the call site for that observation.
  async withTenant<T>(
    tenantId: string,
    fn: (tx: TenantScopedTx) => Promise<T>,
    tag = 'unknown',
  ): Promise<T> {
    if (!tenantId) throw new Error('withTenant: tenantId is required');
    if (!isSafeTenantId(tenantId)) throw new Error(`unsafe tenantId: ${tenantId}`);
    const startNs = process.hrtime.bigint();
    try {
      // Prisma's default interactive-transaction timeout is 5000ms,
      // which is too aggressive for a 5-10 query batch crossing
      // network. Bump to 15s; the actual transaction completes in
      // tens of ms when api + db are colocated. Headroom is for
      // pool-exhaustion + transient connection wobble — not for
      // expected latency. If a real query takes >15s, that's a
      // separate problem (missing index, broken connection) that we
      // want surfaced as a hard fail, not a longer wait.
      return await this.$transaction(
        async (tx) => {
          await tx.$executeRaw`select set_config('app.current_tenant_id', ${tenantId}, true)`;
          return fn(tx as unknown as TenantScopedTx);
        },
        { maxWait: 5000, timeout: 15000 },
      );
    } finally {
      const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      recordQueryTiming('_withTenant', tag, ms);
    }
  }
}

export { Prisma, PrismaQueryStats };
