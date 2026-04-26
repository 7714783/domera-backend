// INIT-008 Phase 3 — env-guard unit tests.
// Run: `node --test apps/api/test/env-guard.test.mjs`

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkProdEnv } from '../dist/common/env-guard.js';

test('passes through when NODE_ENV is not production', () => {
  const errs = checkProdEnv({ NODE_ENV: 'development' });
  assert.equal(errs.length, 0);
});

test('catches missing JWT_SECRET in production', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.domerahub.com',
    DATABASE_URL: 'postgres://x',
  });
  assert.ok(errs.some((e) => e.variable === 'JWT_SECRET'));
});

test('catches dev sentinel JWT_SECRET in production', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'dev-domera-secret-change-me',
    CORS_ORIGINS: 'https://app.domerahub.com',
    DATABASE_URL: 'postgres://x',
  });
  assert.ok(errs.some((e) => e.variable === 'JWT_SECRET' && /sentinel/.test(e.reason)));
});

test('catches short JWT_SECRET in production', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'too-short',
    CORS_ORIGINS: 'https://app.domerahub.com',
    DATABASE_URL: 'postgres://x',
  });
  assert.ok(errs.some((e) => e.variable === 'JWT_SECRET' && /\b32\b/.test(e.reason)));
});

test('catches wildcard CORS in production', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(40),
    CORS_ORIGINS: '*',
    DATABASE_URL: 'postgres://x',
  });
  assert.ok(errs.some((e) => e.variable === 'CORS_ORIGINS'));
});

test('catches missing DATABASE_URL in production', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(40),
    CORS_ORIGINS: 'https://app.domerahub.com',
  });
  assert.ok(errs.some((e) => e.variable === 'DATABASE_URL'));
});

test('passes when all production env is valid', () => {
  const errs = checkProdEnv({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(40),
    CORS_ORIGINS: 'https://app.domerahub.com,https://domerahub.com',
    DATABASE_URL: 'postgres://x',
  });
  assert.equal(errs.length, 0);
});
