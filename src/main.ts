// Autoload .env BEFORE any module imports so Prisma + config consumers see
// DATABASE_URL on first instantiation. Searches the monorepo root (two
// levels up from apps/api/dist) — works whether run via `nest start` or
// `node dist/main.js`.
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

for (const p of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '..', '..', '.env'),
  resolve(__dirname, '..', '..', '..', '.env'),
]) {
  loadDotenv({ path: p });
}

import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { assertProdEnv } from './common/env-guard';
import { setupSwagger } from './openapi';

async function bootstrap() {
  // INIT-008 Phase 3 — fail fast in PROD if env is incomplete or
  // dev-defaults are still in place. Dev / test stay permissive.
  assertProdEnv();

  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('v1');

  // Security headers baseline (CSP / HSTS / X-Content-Type-Options /
  // Referrer-Policy / X-Frame-Options). Disable contentSecurityPolicy
  // because Nest is JSON-only — CSP belongs on the frontend (Next.js)
  // where we actually render HTML. Helmet's other defaults are safe.
  app.use(helmet({ contentSecurityPolicy: false }));

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : true;
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // NS-25 — OpenAPI / Swagger UI at GET /api/docs. Read-only; the
  // served data only mirrors what's already exposed under /v1/*.
  setupSwagger(app);

  await app.listen(process.env.PORT || 4000);
}

void bootstrap();
