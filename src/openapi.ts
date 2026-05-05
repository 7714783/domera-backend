// NS-25 — OpenAPI spec configuration.
//
// Single source of truth for the SwaggerModule setup. Used by:
//   1. main.ts → bootstrap-time wiring of GET /api/docs (dev/local only).
//   2. openapi-gen.ts → headless spec dump for the CI drift gate.
//
// Scope discipline (CEO briefing 2026-05-05): this is an anti-drift
// measure, not a public-API portal. Spec generation + CI diff only.
// Auto-generated client SDKs are explicitly out of scope.

import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export function buildOpenApiConfig() {
  return new DocumentBuilder()
    .setTitle('Domera API')
    .setDescription(
      'Multi-tenant SaaS for building management. ' +
        'All tenant-scoped endpoints require a Bearer token + X-Tenant-Id header. ' +
        'Public endpoints (auth, scanner, public QR) are explicitly tagged.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Tenant-Id' }, 'tenant')
    .build();
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = buildOpenApiConfig();
  return SwaggerModule.createDocument(app, config);
}

// Wire the interactive UI (Swagger / Scalar). Idempotent — call once
// at bootstrap. Safe to call in prod; the route is read-only and the
// served data is what's already exposed under /v1/*.
export function setupSwagger(app: INestApplication): void {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
