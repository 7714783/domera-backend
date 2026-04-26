// INIT-008 Phase 3 — fail-fast production env checks (P1-004).
//
// Called once from main.ts BEFORE NestFactory.create. If NODE_ENV is
// 'production' and any required-for-prod variable is missing or set to a
// known dev sentinel value, throw immediately — better than booting with
// a wildcard CORS or a default JWT secret and getting silent compromises.
//
// Dev / test environments stay permissive: we keep the JWT_SECRET fallback
// and CORS=true so local boot still works without an .env file.

const DEV_JWT_SENTINEL = 'dev-domera-secret-change-me';

export type EnvGuardError = {
  variable: string;
  reason: string;
};

export function checkProdEnv(env: NodeJS.ProcessEnv = process.env): EnvGuardError[] {
  if (env.NODE_ENV !== 'production') return [];
  const errs: EnvGuardError[] = [];

  if (!env.JWT_SECRET) {
    errs.push({ variable: 'JWT_SECRET', reason: 'unset — refusing to use dev fallback in PROD' });
  } else if (env.JWT_SECRET === DEV_JWT_SENTINEL) {
    errs.push({
      variable: 'JWT_SECRET',
      reason: 'matches the dev sentinel — generate a real secret (>= 32 random bytes)',
    });
  } else if (env.JWT_SECRET.length < 32) {
    errs.push({
      variable: 'JWT_SECRET',
      reason: `only ${env.JWT_SECRET.length} chars — minimum 32 for HS256`,
    });
  }

  if (!env.CORS_ORIGINS) {
    errs.push({
      variable: 'CORS_ORIGINS',
      reason: 'unset — wildcard fallback is forbidden in PROD; list explicit origins comma-separated',
    });
  } else if (env.CORS_ORIGINS.trim() === '*' || env.CORS_ORIGINS.trim().toLowerCase() === 'true') {
    errs.push({ variable: 'CORS_ORIGINS', reason: 'wildcard not allowed in PROD' });
  }

  if (!env.DATABASE_URL) {
    errs.push({ variable: 'DATABASE_URL', reason: 'unset — required for Prisma client' });
  }

  return errs;
}

export function assertProdEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errs = checkProdEnv(env);
  if (errs.length === 0) return;
  const msg = errs.map((e) => `  - ${e.variable}: ${e.reason}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n[env-guard] Refusing to start in NODE_ENV=production:\n${msg}\n`);
  throw new Error(`env-guard: ${errs.length} production env violation(s)`);
}
