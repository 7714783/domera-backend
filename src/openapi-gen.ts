// NS-25 — OpenAPI spec generator (CLI entry).
//
// Boots a NestJS application context (no HTTP listener), enumerates
// every controller, dumps the resulting OpenAPI document to
// apps/api/openapi.json, exits.
//
// CI workflow runs this then diffs against the committed file. Any
// drift between code and committed spec fails the gate. Engineer
// either re-runs the gen and commits the new spec OR reverts the
// controller change.
//
// Run via:  pnpm --filter @domera/api openapi:gen
//
// Sets OPENAPI_GEN_MODE=1 so PrismaService + dispatchers skip live
// connections / timers — spec gen does not need a database.

process.env.OPENAPI_GEN_MODE = '1';

// Dummy DATABASE_URLs so PrismaClient constructors accept well-formed
// input even when no real DB env is provisioned in CI. Lazy-connect
// means no network round-trip happens — PrismaService.onModuleInit
// short-circuits on OPENAPI_GEN_MODE before $connect() is called.
const DUMMY_PG = 'postgresql://openapi:gen@localhost:5432/openapi_dummy?schema=public';
process.env.DATABASE_URL ||= DUMMY_PG;
process.env.DATABASE_URL_MIGRATOR ||= DUMMY_PG;
process.env.DATABASE_URL_SUPER ||= DUMMY_PG;
process.env.JWT_SECRET ||= 'openapi-gen-not-for-runtime';

import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './openapi';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('v1');
  await app.init();
  const document = buildOpenApiDocument(app);

  // Stable JSON output: pretty-print so the diff in CI is readable
  // and consistent across runs. The keys come from Nest's reflection
  // in module-registration order, which is stable across builds.
  const out = resolve(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n', 'utf8');

  await app.close();
  console.log(
    `OpenAPI spec written: ${out}\n  paths: ${Object.keys(document.paths || {}).length}\n  tags: ${(document.tags || []).length}`,
  );
}

main().catch((e) => {
  console.error('openapi-gen failed:', e);
  process.exit(1);
});
