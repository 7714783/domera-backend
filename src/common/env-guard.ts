// INIT-008 Phase 3 — production env checks (P1-004).
//
// Two severities:
//   - 'hard'  — process MUST NOT start. Exits with non-zero. Examples:
//               JWT_SECRET set to the dev sentinel (real security hole),
//               DATABASE_URL missing (app cannot function).
//   - 'soft'  — log a loud warning but allow boot. Operator should fix
//               but the deploy proceeds. Examples: CORS wildcard,
//               JWT_SECRET shorter than 32 chars but custom.
//
// Why soft: Railway / Vercel staged rollouts are easier to recover from
// when the new container at least boots. A hard-crash on every boot blocks
// rollback flexibility. Hard reasons remain — but they're narrowed to
// "the deploy is unambiguously insecure" not "config is incomplete".
//
// Strict mode: set ENV_GUARD_STRICT=true to escalate every soft warning
// to hard. Default off so Railway adoption isn't blocked on env-tightening.
//
// Dev / test environments stay permissive: every check returns an empty
// list when NODE_ENV !== 'production'.

const DEV_JWT_SENTINEL = 'dev-domera-secret-change-me';

export type EnvGuardError = {
  variable: string;
  severity: 'hard' | 'soft';
  reason: string;
};

export function checkProdEnv(env: NodeJS.ProcessEnv = process.env): EnvGuardError[] {
  if (env.NODE_ENV !== 'production') return [];
  const errs: EnvGuardError[] = [];

  if (!env.JWT_SECRET) {
    errs.push({
      variable: 'JWT_SECRET',
      severity: 'hard',
      reason: 'unset — refusing to use dev fallback in PROD',
    });
  } else if (env.JWT_SECRET === DEV_JWT_SENTINEL) {
    errs.push({
      variable: 'JWT_SECRET',
      severity: 'hard',
      reason: 'matches the dev sentinel — generate a real secret (>= 32 random bytes)',
    });
  } else if (env.JWT_SECRET.length < 32) {
    errs.push({
      variable: 'JWT_SECRET',
      severity: 'soft',
      reason: `only ${env.JWT_SECRET.length} chars — recommend >= 32 for HS256`,
    });
  }

  if (!env.CORS_ORIGINS) {
    errs.push({
      variable: 'CORS_ORIGINS',
      severity: 'soft',
      reason: 'unset — defaults to wildcard; list explicit origins comma-separated for tightened CORS',
    });
  } else if (env.CORS_ORIGINS.trim() === '*' || env.CORS_ORIGINS.trim().toLowerCase() === 'true') {
    errs.push({
      variable: 'CORS_ORIGINS',
      severity: 'soft',
      reason: 'wildcard CORS in PROD — recommend explicit origin list',
    });
  }

  if (!env.DATABASE_URL) {
    errs.push({
      variable: 'DATABASE_URL',
      severity: 'hard',
      reason: 'unset — required for Prisma client',
    });
  }

  // INIT-014 — outbound email provider must NOT be `noop` in production.
  // The dispatcher will silently swallow every send otherwise. Soft so
  // a partial deploy can still boot; ENV_GUARD_STRICT escalates it.
  const provider = (env.EMAIL_PROVIDER || 'noop').toLowerCase();
  if (provider === 'noop') {
    errs.push({
      variable: 'EMAIL_PROVIDER',
      severity: 'soft',
      reason:
        'noop in PROD — emails will not actually leave the box; set to "resend" (default) or "smtp"/"ses"',
    });
  }
  if (provider === 'resend') {
    // INIT-014 — Resend is the default production provider. API key
    // mandatory; webhook secret required to verify svix-signed inbound.
    if (!env.RESEND_API_KEY) {
      errs.push({
        variable: 'RESEND_API_KEY',
        severity: 'hard',
        reason:
          'EMAIL_PROVIDER=resend but RESEND_API_KEY is unset — every send will fail',
      });
    } else if (!env.RESEND_API_KEY.startsWith('re_')) {
      errs.push({
        variable: 'RESEND_API_KEY',
        severity: 'soft',
        reason:
          'does not start with "re_" — Resend keys begin with that prefix, double-check the env',
      });
    }
    if (!env.RESEND_WEBHOOK_SECRET) {
      errs.push({
        variable: 'RESEND_WEBHOOK_SECRET',
        severity: 'soft',
        reason:
          'unset — Resend inbound webhooks will be rejected (svix signature cannot be verified). Required if you accept replies/bounces.',
      });
    }
  }
  if (provider === 'smtp') {
    if (!env.SMTP_HOST) {
      errs.push({
        variable: 'SMTP_HOST',
        severity: 'soft',
        reason: 'EMAIL_PROVIDER=smtp but SMTP_HOST is unset',
      });
    }
  }
  if (!env.EMAIL_FROM) {
    errs.push({
      variable: 'EMAIL_FROM',
      severity: 'soft',
      reason: 'unset — defaults to notifications@domerahub.com; set explicitly per workspace domain',
    });
  }
  // Inbound webhook shared-secret fallback: only required when the
  // provider doesn't sign on its own. Resend (svix) and SES (SNS) DO
  // sign — only the SMTP-relay path needs INBOUND_EMAIL_SECRET.
  const providerSelfSigns = provider === 'resend' || provider === 'ses';
  if (!env.INBOUND_EMAIL_SECRET && !providerSelfSigns) {
    errs.push({
      variable: 'INBOUND_EMAIL_SECRET',
      severity: 'soft',
      reason:
        'unset — without it, /v1/mail/inbound/:provider rejects unsigned payloads (correct for Resend/SES; required for SMTP relay)',
    });
  }

  return errs;
}

export function assertProdEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errs = checkProdEnv(env);
  if (errs.length === 0) return;

  const strict = (env.ENV_GUARD_STRICT || '').toLowerCase() === 'true';
  const hard = errs.filter((e) => e.severity === 'hard' || strict);
  const soft = errs.filter((e) => e.severity === 'soft' && !strict);

  if (soft.length > 0) {
     
    console.warn(
      `\n[env-guard] ${soft.length} soft warning(s) in NODE_ENV=production:\n` +
        soft.map((e) => `  - ${e.variable}: ${e.reason}`).join('\n') +
        '\n[env-guard] Set ENV_GUARD_STRICT=true to escalate these to hard failures.\n',
    );
  }

  if (hard.length > 0) {
     
    console.error(
      `\n[env-guard] Refusing to start — ${hard.length} hard violation(s):\n` +
        hard.map((e) => `  - ${e.variable}: ${e.reason}`).join('\n') +
        '\n',
    );
    throw new Error(`env-guard: ${hard.length} hard production env violation(s)`);
  }
}
