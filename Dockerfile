# Multi-stage build for Domera backend on Railway.
# Nixpacks auto-install of libatomic1 was OOM-killed (exit 137) on Railway's
# build runner — bypass Nixpacks entirely with this explicit Dockerfile.

# --------- build: install all deps, generate Prisma client, compile TS ---------
FROM node:22-slim AS build
WORKDIR /app

# openssl is required by @prisma/client at runtime on Debian slim images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy lock + manifest first for better layer caching.
COPY package.json package-lock.json ./
# prisma schema must exist before install so the `postinstall: prisma generate` hook works.
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npx nest build \
    && npm prune --omit=dev

# --------- runtime: copy pre-built artefacts into a clean slim image ---------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./

EXPOSE 4000

# Apply pending raw-SQL migrations on every start. Idempotent — files already
# in _sql_migrations are skipped. Without this, freshly-added migrations in
# prisma/migrations-sql/ never reach the running DB and the Prisma client
# crashes when it expects columns the DB doesn't have. INIT-005 Phase 1 root
# cause: 002/003/004/005 sat unapplied for weeks → /units, /locations, /unit-groups
# all returned 500.
# tini reaps zombie children (BullMQ workers, Prisma engine) on SIGTERM.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "node prisma/migrations-sql/apply-migrations.mjs && node dist/main.js"]
