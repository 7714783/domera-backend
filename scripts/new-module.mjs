#!/usr/bin/env node
// Module scaffolding generator.
//
// Pinned by docs/architecture/platform-development-contract.md § 11.
// Run: `node scripts/new-module.mjs <name>`
//
// Creates:
//   apps/api/src/modules/<name>/<name>.module.ts
//   apps/api/src/modules/<name>/<name>.controller.ts
//   apps/api/src/modules/<name>/<name>.service.ts
//   docs/modules/<name>/RFC.md  (copy of _template)
//   prints next-step reminders for OWNERSHIP / state-machine / event-contract maps
//
// Idempotent. Refuses to overwrite existing files. The point is to make
// "skip the RFC" require active deletion.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const arg = process.argv[2];
if (!arg || !/^[a-z][a-z0-9-]*$/.test(arg)) {
  console.error('Usage: node scripts/new-module.mjs <kebab-case-name>');
  console.error('       names must be lowercase kebab-case (e.g. "tenant-portal")');
  process.exit(1);
}

const folder = arg;
const className = folder
  .split('-')
  .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  .join('');

const apiBase = join(repoRoot, 'apps', 'api');
const moduleDir = join(apiBase, 'src', 'modules', folder);
const docsDir = join(repoRoot, 'docs', 'modules', folder);
const rfcTemplate = join(repoRoot, 'docs', 'modules', '_template', 'RFC.md');

if (existsSync(moduleDir)) {
  console.error(`refuse to overwrite: ${moduleDir} already exists`);
  process.exit(1);
}
if (!existsSync(rfcTemplate)) {
  console.error(`RFC template missing at ${rfcTemplate} — restore it first`);
  process.exit(1);
}

mkdirSync(moduleDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

writeFileSync(
  join(moduleDir, `${folder}.module.ts`),
  `import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ${className}Controller } from './${folder}.controller';
import { ${className}Service } from './${folder}.service';

@Module({
  imports: [AuthModule],
  controllers: [${className}Controller],
  providers: [${className}Service],
  exports: [${className}Service],
})
export class ${className}Module {}
`,
);

writeFileSync(
  join(moduleDir, `${folder}.controller.ts`),
  `import { Controller, Get, Headers } from '@nestjs/common';
import { resolveTenantId } from '../../common/tenant.utils';
import { ${className}Service } from './${folder}.service';

@Controller('${folder}')
export class ${className}Controller {
  constructor(private readonly svc: ${className}Service) {}

  @Get()
  list(@Headers('x-tenant-id') th?: string) {
    return this.svc.list(resolveTenantId(th));
  }
}
`,
);

writeFileSync(
  join(moduleDir, `${folder}.service.ts`),
  `import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// TODO(${className}): implement against the RFC at
// docs/modules/${folder}/RFC.md. Until then this is a placeholder.

@Injectable()
export class ${className}Service {
  constructor(private readonly prisma: PrismaService) {}

  async list(_tenantId: string) {
    return [];
  }
}
`,
);

const tpl = readFileSync(rfcTemplate, 'utf8');
writeFileSync(
  join(docsDir, 'RFC.md'),
  tpl
    .replace('<module-name>', folder)
    .replace('## 1. Why this module exists', `## 1. Why this module exists\n\n_TODO — fill in for ${folder}._`),
);

console.log(`✓ scaffolded module "${folder}"`);
console.log('');
console.log('Next steps (CI will block your PR otherwise):');
console.log(`  1. Fill in docs/modules/${folder}/RFC.md`);
console.log(`  2. Register ${className}Module in apps/api/src/app.module.ts imports[]`);
console.log(`  3. If this module owns entities:`);
console.log(`     - add OWNERSHIP rows in apps/api/test/ssot-ownership.test.mjs`);
console.log(`     - add row to docs/architecture/entity-ownership-ssot.md ownership map`);
console.log(`  4. If this module has a workflow:`);
console.log(`     - add REGISTRY entry in apps/api/test/state-machine.test.mjs`);
console.log(`  5. If this module publishes events:`);
console.log(`     - add CATALOG entry in apps/api/test/event-contract.test.mjs`);
console.log(`  6. Remove "${folder}" from RETRO_RFC_PENDING in apps/api/test/module-rfc.test.mjs`);
console.log(`     (it never got there — but if you copy from an existing module, double-check)`);
console.log('');
console.log('See docs/architecture/platform-development-contract.md for the full contract.');
