// Autoload .env BEFORE any Nest imports so Prisma + config consumers see
// DATABASE_URL on first instantiation. In Railway / hosted envs the vars
// come straight from the runtime, so dotenv is a no-op there.
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

for (const p of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '..', '..', '.env'),
  resolve(__dirname, '..', '..', '..', '.env'),
]) {
  loadDotenv({ path: p });
}

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const log = new Logger('bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('v1');

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : true;
  app.enableCors({ origin: corsOrigins, credentials: true });

  const port = Number(process.env.PORT) || 4000;
  // Bind to 0.0.0.0 so Railway / Docker ingress can reach the container —
  // Nest's default IPv6 bind (::) isn't always proxied on PaaS runners.
  await app.listen(port, '0.0.0.0');
  log.log(`listening on 0.0.0.0:${port} (healthcheck: GET /v1/health)`);
}

void bootstrap();
