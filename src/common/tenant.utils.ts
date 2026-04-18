export function resolveTenantId(headerValue?: string): string {
  return headerValue || 'ten_demo';
}
