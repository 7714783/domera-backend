import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  tenantId: string;
  bypass?: boolean;
}

const als = new AsyncLocalStorage<TenantStore>();

export const TenantContext = {
  run<T>(store: TenantStore, fn: () => Promise<T> | T): Promise<T> | T {
    return als.run(store, fn);
  },
  get(): TenantStore | undefined {
    return als.getStore();
  },
  getTenantId(): string | undefined {
    const s = als.getStore();
    return s?.bypass ? undefined : s?.tenantId;
  },
  isBypass(): boolean {
    return !!als.getStore()?.bypass;
  },
};
