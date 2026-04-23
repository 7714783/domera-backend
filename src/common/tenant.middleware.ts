import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
// Use the BYPASSRLS client — this check runs BEFORE TenantContext is set,
// so the RLS-wrapped PrismaService would filter all rows out.
import { MigratorPrismaService } from '../prisma/prisma.migrator';
import { TenantContext } from './tenant-context';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-domera-secret-change-me';

const BYPASS_PATHS = [
  '/v1/health',
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/refresh',
  '/v1/auth/me',
  '/v1/auth/memberships',
  '/v1/onboarding/my-workspaces',
  '/v1/onboarding/bootstrap',
  '/v1/seed-runtime',
  '/v1/public/qr',
  '/v1/metrics',
  '/v1/documents/signed/',
  '/v1/sso/callback',
  '/v1/public/cleaning/',
];

// Per-process cache so repeated calls from the same session don't re-hit the
// DB. TTL-capped at 60s — a freshly-revoked role takes effect within that
// window without any explicit invalidation bus.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 2000;
const membershipCache = new Map<string, { allowed: boolean; expiresAt: number }>();
const activeTenantCache = new Map<string, { tenantId: string; expiresAt: number }>();

function cacheKey(userId: string, tenantId: string): string {
  return `${userId}:${tenantId}`;
}
function getCached(userId: string, tenantId: string): boolean | null {
  const hit = membershipCache.get(cacheKey(userId, tenantId));
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    membershipCache.delete(cacheKey(userId, tenantId));
    return null;
  }
  return hit.allowed;
}
function putCached(userId: string, tenantId: string, allowed: boolean): void {
  if (membershipCache.size >= CACHE_MAX) {
    const first = membershipCache.keys().next().value;
    if (first) membershipCache.delete(first);
  }
  membershipCache.set(cacheKey(userId, tenantId), {
    allowed,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly prisma: MigratorPrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const path = req.path || req.url || '';
    const bypass = BYPASS_PATHS.some((p) => path.startsWith(p));

    // Bypass paths (auth, health, public) run without tenant context.
    if (bypass) {
      return TenantContext.run({ tenantId: '', bypass: true }, () => next());
    }

    const header = req.header('x-tenant-id');
    const auth = req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

    let payload: { sub?: string; superadmin?: boolean } | null = null;
    if (token) {
      try {
        payload = jwt.verify(token, JWT_SECRET) as any;
      } catch {
        payload = null;
      }
    }

    // Resolve effective tenantId.
    //   1. If header is set: must match a membership of the authenticated user
    //      (superadmins may set any tenantId).
    //   2. If header is empty but user is authenticated: auto-resolve to the
    //      user's default active membership.
    //   3. Anonymous + no header: downstream resolveTenantId() throws 400 — the
    //      controller then rejects. Do NOT fall back to a demo tenant.
    let tenantId = header || '';

    if (payload?.sub && !header) {
      const cached = activeTenantCache.get(payload.sub);
      if (cached && cached.expiresAt > Date.now()) {
        tenantId = cached.tenantId;
      } else {
        const m = await this.prisma.membership.findFirst({
          where: { userId: payload.sub, status: 'active' },
          select: { tenantId: true },
          orderBy: { createdAt: 'asc' },
        });
        if (m?.tenantId) {
          tenantId = m.tenantId;
          activeTenantCache.set(payload.sub, {
            tenantId: m.tenantId,
            expiresAt: Date.now() + CACHE_TTL_MS,
          });
        } else {
          // Fall through: no membership; controller will 400/404 on its own.
        }
      }
    }

    // If an explicit header was provided AND the user is authenticated, verify
    // membership (the previous behaviour). Superadmins bypass this check.
    if (token && header && payload?.sub && !payload.superadmin) {
      const userId = payload.sub;
      let allowed = getCached(userId, tenantId);
      if (allowed === null) {
        const m = await this.prisma.membership.findFirst({
          where: { tenantId, userId },
          select: { id: true },
        });
        if (m) {
          allowed = true;
        } else {
          const bra = await this.prisma.buildingRoleAssignment.findFirst({
            where: { tenantId, userId },
            select: { id: true },
          });
          allowed = !!bra;
        }
        putCached(userId, tenantId, allowed);
      }
      if (!allowed) {
        throw new ForbiddenException(
          'X-Tenant-Id does not match the authenticated user memberships',
        );
      }
    }

    // Set the header on the request so downstream resolveTenantId() picks it up.
    if (tenantId) req.headers['x-tenant-id'] = tenantId;

    return TenantContext.run({ tenantId, bypass: false }, () => next());
  }
}
