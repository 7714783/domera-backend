import { BadRequestException } from '@nestjs/common';

/**
 * Resolve tenantId for a request.
 *
 * Throws 400 when missing — the previous silent fallback to the demo tenant
 * was the P0 leakage root cause (any headerless request landed in the demo
 * workspace and saw its data). TenantMiddleware now auto-populates the header
 * from the authenticated user's active membership BEFORE this is called, so
 * reaching this path without a value means the caller is anonymous on a
 * tenant-scoped route — let controllers reject with 401 upstream.
 */
export function resolveTenantId(headerValue?: string): string {
  if (!headerValue) {
    throw new BadRequestException(
      'X-Tenant-Id header is required (no active tenant membership resolved)',
    );
  }
  return headerValue;
}
