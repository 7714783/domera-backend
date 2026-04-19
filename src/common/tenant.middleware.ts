import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { resolveTenantId } from './tenant.utils';
import { TenantContext } from './tenant-context';

const BYPASS_PATHS = [
  '/v1/health',
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/refresh',
  '/v1/seed-runtime',
  '/v1/public/qr',
  '/v1/metrics',
  '/v1/documents/signed/',
  '/v1/sso/callback',
];

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const header = req.header('x-tenant-id');
    const path = req.path || req.url || '';
    const bypass = BYPASS_PATHS.some((p) => path.startsWith(p));
    const tenantId = resolveTenantId(header);
    TenantContext.run({ tenantId, bypass }, () => next());
  }
}
