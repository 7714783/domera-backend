// INIT-003 NS-8 — `@Tenant()` param decorator.
//
// TenantMiddleware already populates TenantContext (AsyncLocalStorage)
// AND the `x-tenant-id` header for the rest of the request. The legacy
// idiom every controller uses today is:
//
//     @Headers('x-tenant-id') tenantIdHeader?: string,
//     ...
//     const tenantId = resolveTenantId(tenantIdHeader);
//
// This decorator collapses both lines into:
//
//     @Tenant() tenantId: string,
//
// It reads from TenantContext (the canonical source after middleware
// runs) and falls back to the request header (covers the rare ordering
// cases where a controller method signature is evaluated outside the
// ALS scope; should never happen in practice but keeps the decorator
// safe even before the global ALS context wraps the entire stack).
//
// Throws 400 BadRequest if no tenantId is set — same contract as
// resolveTenantId(), so the existing tests/CI behaviour is preserved.
//
// MIGRATION (mechanical sweep, opportunistic):
//   - find: @Headers('x-tenant-id') (\w+)\?: string,?
//     remove the parameter
//   - find: const (\w+) = resolveTenantId\((\w+)\);
//     remove the line; the decorator already returns the resolved id
//   - replace the method's signature with @Tenant() <name>: string,
//
// Done a controller at a time, NOT in one massive sed — small per-file
// PRs keep the diff reviewable and CI catches regressions early.

import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { TenantContext } from './tenant-context';

export const Tenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  // Prefer TenantContext (the source of truth populated by
  // TenantMiddleware before any controller runs).
  const fromAls = TenantContext.getTenantId();
  if (fromAls) return fromAls;

  // Fallback: read the header the middleware also writes onto
  // req.headers. Belt-and-braces — legacy code paths.
  const req = ctx.switchToHttp().getRequest<Request>();
  const fromHeader = req?.header?.('x-tenant-id');
  if (fromHeader) return fromHeader;

  throw new BadRequestException('X-Tenant-Id is required (no active tenant membership resolved)');
});
