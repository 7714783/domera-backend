// NS-25 — pin the OpenAPI anti-drift contract.
//
// Properties this gate keeps honest:
//
//   1. setupSwagger() is called from main.ts so /api/docs serves the
//      live spec in dev. If the call is dropped, the docs route 404s
//      and developers lose the visual sanity check.
//   2. PrismaService + MigratorPrismaService + dispatcher onModuleInit
//      hooks short-circuit on OPENAPI_GEN_MODE=1. Without the skip,
//      the gen script would require a live Postgres + dangling timers
//      and the CI workflow would need a postgres service container.
//   3. apps/api/package.json declares an openapi:gen script.
//   4. The committed openapi.json baseline exists and is non-trivial.
//   5. The .github/workflows/openapi-diff.yml workflow exists with
//      the canonical `git diff --exit-code apps/api/openapi.json`
//      check — that single line IS the anti-drift gate.
//
// This is a SOURCE-LEVEL pin. It does not regenerate the spec. The
// runtime gate (the workflow itself) does that.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..');
const repoRoot = join(apiRoot, '..', '..');

const main = readFileSync(join(apiRoot, 'src', 'main.ts'), 'utf8');
const openapiHelper = readFileSync(join(apiRoot, 'src', 'openapi.ts'), 'utf8');
const genEntry = readFileSync(join(apiRoot, 'src', 'openapi-gen.ts'), 'utf8');
const prismaService = readFileSync(join(apiRoot, 'src', 'prisma', 'prisma.service.ts'), 'utf8');
const prismaMigrator = readFileSync(join(apiRoot, 'src', 'prisma', 'prisma.migrator.ts'), 'utf8');
const outboxDispatcher = readFileSync(
  join(apiRoot, 'src', 'modules', 'events', 'outbox.dispatcher.ts'),
  'utf8',
);
const deliveryDispatcher = readFileSync(
  join(apiRoot, 'src', 'modules', 'notifications', 'delivery.dispatcher.ts'),
  'utf8',
);
const pkg = JSON.parse(readFileSync(join(apiRoot, 'package.json'), 'utf8'));

test('main.ts imports + calls setupSwagger', () => {
  assert.match(
    main,
    /import \{ setupSwagger \} from ['"]\.\/openapi['"]/,
    'main.ts must import setupSwagger from ./openapi',
  );
  assert.match(main, /setupSwagger\(app\);/, 'main.ts must call setupSwagger(app)');
});

test('openapi.ts helper exports buildOpenApiDocument + setupSwagger', () => {
  assert.match(
    openapiHelper,
    /export function setupSwagger\(app:\s*INestApplication\):\s*void/,
    'openapi.ts must export setupSwagger(app: INestApplication)',
  );
  assert.match(
    openapiHelper,
    /export function buildOpenApiDocument\(/,
    'openapi.ts must export buildOpenApiDocument() so the gen script can call it',
  );
  assert.match(
    openapiHelper,
    /SwaggerModule\.setup\(['"]api\/docs['"],/,
    'setupSwagger must mount the UI at api/docs (no leading slash — Nest path)',
  );
});

test('PrismaService.onModuleInit short-circuits on OPENAPI_GEN_MODE=1', () => {
  assert.match(
    prismaService,
    /OPENAPI_GEN_MODE\b[\s\S]{0,12}===?\s*['"]1['"]/,
    'PrismaService.onModuleInit must check process.env.OPENAPI_GEN_MODE === "1"',
  );
});

test('MigratorPrismaService.onModuleInit short-circuits on OPENAPI_GEN_MODE=1', () => {
  assert.match(
    prismaMigrator,
    /OPENAPI_GEN_MODE\b[\s\S]{0,12}===?\s*['"]1['"]/,
    'MigratorPrismaService.onModuleInit must skip $connect when OPENAPI_GEN_MODE=1',
  );
});

test('Outbox + delivery dispatchers skip timers on OPENAPI_GEN_MODE=1', () => {
  assert.match(
    outboxDispatcher,
    /OPENAPI_GEN_MODE\b[\s\S]{0,12}===?\s*['"]1['"]/,
    'OutboxDispatcher.onModuleInit must short-circuit on OPENAPI_GEN_MODE=1 (no dangling timer in spec gen)',
  );
  assert.match(
    deliveryDispatcher,
    /OPENAPI_GEN_MODE\b[\s\S]{0,12}===?\s*['"]1['"]/,
    'DeliveryDispatcher.onModuleInit must short-circuit on OPENAPI_GEN_MODE=1',
  );
});

test('openapi-gen.ts entry sets dummy DB env BEFORE importing AppModule', () => {
  // Import order matters: PrismaClient constructors run on import,
  // BEFORE NestJS even sees them. So dummy DATABASE_URLs must be
  // injected at the very top of the file, before AppModule import.
  // We pin: the env-injection block must appear textually BEFORE the
  // AppModule import line.
  const envIdx = genEntry.indexOf('process.env.DATABASE_URL ||=');
  const importIdx = genEntry.indexOf("from './app.module'");
  assert.ok(envIdx > 0, 'openapi-gen.ts must set dummy DATABASE_URL');
  assert.ok(importIdx > 0, "openapi-gen.ts must import from './app.module'");
  assert.ok(
    envIdx < importIdx,
    'dummy DB env must be injected BEFORE AppModule import (PrismaClient constructors run on import)',
  );
});

test('apps/api/package.json declares openapi:gen script', () => {
  assert.ok(
    pkg.scripts && typeof pkg.scripts['openapi:gen'] === 'string',
    'package.json must declare scripts["openapi:gen"]',
  );
  // The script must build then run dist — not point at src directly,
  // because we don't pull tsx as a dep.
  assert.match(
    pkg.scripts['openapi:gen'],
    /nest build.*node dist\/openapi-gen\.js/,
    'openapi:gen must `nest build && node dist/openapi-gen.js`',
  );
});

test('committed apps/api/openapi.json baseline exists and is non-trivial', () => {
  const specPath = join(apiRoot, 'openapi.json');
  assert.ok(existsSync(specPath), 'apps/api/openapi.json must be committed as the baseline');
  const stat = statSync(specPath);
  assert.ok(stat.size > 10_000, `openapi.json must be substantial (got ${stat.size} bytes)`);
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  assert.equal(typeof spec.openapi, 'string', 'spec must declare openapi version');
  assert.ok(
    spec.paths && Object.keys(spec.paths).length >= 50,
    `spec.paths must have ≥50 entries (got ${Object.keys(spec.paths || {}).length})`,
  );
});

test('CI gate workflow exists with the canonical diff line', () => {
  const wf = readFileSync(join(repoRoot, '.github', 'workflows', 'openapi-diff.yml'), 'utf8');
  assert.match(
    wf,
    /git diff --exit-code apps\/api\/openapi\.json/,
    'workflow must run `git diff --exit-code apps/api/openapi.json` — that line IS the gate',
  );
  assert.match(
    wf,
    /pnpm --filter @domera\/api openapi:gen/,
    'workflow must call `pnpm --filter @domera/api openapi:gen` to regenerate the spec',
  );
});
