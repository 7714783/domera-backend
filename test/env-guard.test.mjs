// INIT-008 Phase 3 — env-guard unit tests.
// Run: `node --test apps/api/test/env-guard.test.mjs`

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkProdEnv } from '../dist/common/env-guard.js';

test('passes through when NODE_ENV is not production', () => {
  const errs = checkProdEnv({ NODE_ENV: 'development' });
  assert.equal(errs.length, 0);
});

test('catches missing JWT_SECRET as hard violation', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.domerahub.com',
    DATABASE_URL: 'postgres://x',
  });
  const j = errs.find((e) => e.variable === 'JWT_SECRET');
  assert.ok(j);
  assert.equal(j.severity, 'hard');
});

test('catches dev sentinel JWT_SECRET as hard violation', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'dev-domera-secret-change-me',
    CORS_ORIGINS: 'https://app.domerahub.com',
    DATABASE_URL: 'postgres://x',
  });
  const j = errs.find((e) => e.variable === 'JWT_SECRET' && /sentinel/.test(e.reason));
  assert.ok(j);
  assert.equal(j.severity, 'hard');
});

test('catches short JWT_SECRET as soft violation (recommend not require)', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'too-short-but-not-empty',
    CORS_ORIGINS: 'https://app.domerahub.com',
    DATABASE_URL: 'postgres://x',
  });
  const j = errs.find((e) => e.variable === 'JWT_SECRET');
  assert.ok(j);
  assert.equal(j.severity, 'soft');
});

test('catches wildcard CORS as soft violation', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(40),
    CORS_ORIGINS: '*',
    DATABASE_URL: 'postgres://x',
  });
  const j = errs.find((e) => e.variable === 'CORS_ORIGINS');
  assert.ok(j);
  assert.equal(j.severity, 'soft');
});

test('catches missing DATABASE_URL as hard violation', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(40),
    CORS_ORIGINS: 'https://app.domerahub.com',
  });
  const d = errs.find((e) => e.variable === 'DATABASE_URL');
  assert.ok(d);
  assert.equal(d.severity, 'hard');
});

test('passes when all production env is valid', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(40),
    CORS_ORIGINS: 'https://app.domerahub.com,https://domerahub.com',
    DATABASE_URL: 'postgres://x',
    // INIT-014 — outbound email + inbound webhook config required so
    // the env-guard does not emit soft warnings for the noop default
    // / missing EMAIL_FROM / missing INBOUND_EMAIL_SECRET.
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.example.com',
    EMAIL_FROM: 'notifications@example.com',
    INBOUND_EMAIL_SECRET: 'inbound-webhook-shared-secret',
  });
  assert.equal(errs.length, 0);
});
