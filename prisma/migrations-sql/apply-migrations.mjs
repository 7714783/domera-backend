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
import { PrismaClient } from '@prisma/client';

function loadDir() {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
  const fallback = path.resolve(process.cwd(), 'apps/api/prisma/migrations-sql');
  return fs.existsSync(here) ? here : fallback;
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
    if (!inSingle && next2 === '$$') { inDollar = !inDollar; buf += '$$'; i += 1; continue; }
    if (!inDollar && c === "'") { inSingle = !inSingle; buf += c; continue; }
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
  if (!url) { console.error('[migrate] DATABASE_URL_MIGRATOR or DATABASE_URL required'); process.exit(1); }
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await ensureTable(client);
    const dir = loadDir();
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const appliedRows = await client.$queryRawUnsafe('SELECT name FROM _sql_migrations');
    const applied = new Set(appliedRows.map((r) => r.name));
    let ran = 0;
    for (const f of files) {
      if (applied.has(f)) { console.log(`[migrate] skip ${f} (already applied)`); continue; }
      console.log(`[migrate] apply ${f}`);
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      // Strip full-line comments so the splitter doesn't see stray semicolons.
      const stripped = raw.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
      const stmts = splitSql(stripped);
      // Run all statements + the tracking insert in one transaction so partial
      // failures roll back cleanly.
      await client.$transaction(async (tx) => {
        for (const stmt of stmts) {
          await tx.$executeRawUnsafe(stmt);
        }
        await tx.$executeRaw`INSERT INTO _sql_migrations (name) VALUES (${f})`;
      });
      console.log(`[migrate]   ${stmts.length} statements applied`);
      ran += 1;
    }
    console.log(`[migrate] done · ${ran} new · ${files.length - ran} already applied`);
  } finally {
    await client.$disconnect();
  }
}

run().catch((e) => { console.error('[migrate] failed', e); process.exit(1); });
