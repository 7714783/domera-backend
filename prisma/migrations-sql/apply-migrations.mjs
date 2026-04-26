// Minimal raw-SQL migration runner for cases where a Prisma-level @@unique
// cannot express the constraint (e.g. partial unique with WHERE). Idempotent:
// files are tracked in a _sql_migrations table. Re-running only applies files
// that are new.
//
// Usage (from repo root or apps/api):
//   node apps/api/prisma/migrations-sql/apply-migrations.mjs
//
// Uses DATABASE_URL_MIGRATOR if set, otherwise DATABASE_URL.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

function loadDir() {
  // fileURLToPath handles Windows (C:\...) and Linux (/home/...) correctly.
  // Previously `new URL(...).pathname.replace(/^\//,'')` on Linux produced
  // a relative path that fs.existsSync rejected — the runner then fell back
  // to the monorepo path `apps/api/prisma/migrations-sql` which doesn't
  // exist in the split-repo layout and the runner silently applied nothing.
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (fs.existsSync(here)) return here;
  const monorepoFallback = path.resolve(process.cwd(), 'apps/api/prisma/migrations-sql');
  if (fs.existsSync(monorepoFallback)) return monorepoFallback;
  const splitRepoFallback = path.resolve(process.cwd(), 'prisma/migrations-sql');
  return splitRepoFallback;
}

async function ensureTable(client) {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS _sql_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

// Split raw SQL into individual top-level statements. Handles $$...$$ blocks
// and single-quoted strings so we don't split on semicolons inside them.
function splitSql(sql) {
  const parts = [];
  let buf = '';
  let inDollar = false;
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next2 = sql.slice(i, i + 2);
    if (!inSingle && next2 === '$$') {
      inDollar = !inDollar;
      buf += '$$';
      i += 1;
      continue;
    }
    if (!inDollar && c === "'") {
      inSingle = !inSingle;
      buf += c;
      continue;
    }
    if (!inDollar && !inSingle && c === ';') {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
      continue;
    }
    buf += c;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts.filter((p) => !/^--/.test(p) && p.length > 0);
}

async function run() {
  const url = process.env.DATABASE_URL_MIGRATOR || process.env.DATABASE_URL;
  if (!url) {
    console.error('[migrate] DATABASE_URL_MIGRATOR or DATABASE_URL required');
    process.exit(1);
  }
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await ensureTable(client);
    const dir = loadDir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const appliedRows = await client.$queryRawUnsafe('SELECT name FROM _sql_migrations');
    const applied = new Set(appliedRows.map((r) => r.name));
    let ran = 0;
    for (const f of files) {
      if (applied.has(f)) {
        console.log(`[migrate] skip ${f} (already applied)`);
        continue;
      }
      console.log(`[migrate] apply ${f}`);
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      // Strip full-line comments so the splitter doesn't see stray semicolons.
      const stripped = raw
        .split('\n')
        .filter((l) => !/^\s*--/.test(l))
        .join('\n');
      const stmts = splitSql(stripped);
      // Run all statements + the tracking insert in one transaction so partial
      // failures roll back cleanly. Bumped maxWait/timeout from defaults
      // (2s/5s) because larger migrations (DO $$ blocks, multiple ALTER TABLEs
      // with RLS policies and grants) reliably hit the 5s ceiling and roll
      // back silently — caller then thinks it applied but tables are missing.
      await client.$transaction(
        async (tx) => {
          for (const stmt of stmts) {
            await tx.$executeRawUnsafe(stmt);
          }
          await tx.$executeRaw`INSERT INTO _sql_migrations (name) VALUES (${f})`;
        },
        { maxWait: 30000, timeout: 120000 },
      );
      console.log(`[migrate]   ${stmts.length} statements applied`);
      ran += 1;
    }
    console.log(`[migrate] done · ${ran} new · ${files.length - ran} already applied`);
  } finally {
    await client.$disconnect();
  }
}

run().catch((e) => {
  console.error('[migrate] failed', e);
  process.exit(1);
});
