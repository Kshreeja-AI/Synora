# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Synora backend API — production image.
#
# Multi-stage: a builder stage installs the full pnpm workspace, generates the
# Prisma client, and compiles the backend and its workspace dependencies
# (@synora/database, @synora/shared); the runtime stage copies the builder's
# entire /app (including dev dependencies — see the comment above the COPY
# below for why) and runs `node apps/backend/dist/index.js` as a non-root
# user. The separate stage still keeps the base-image layer and any
# builder-only OS packages out of the shipped image, even though node_modules
# itself is not pruned.
#
# bookworm-slim (glibc), not alpine (musl): the argon2 native addon and the
# Prisma query engine are far less troublesome on glibc.
# ---------------------------------------------------------------------------

# Pinned to the pnpm version in package.json's packageManager field.
ARG NODE_IMAGE=node:22-bookworm-slim

# --- Builder ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Enable corepack so the exact pnpm from packageManager is used.
RUN corepack enable
WORKDIR /app

# Copy the whole workspace (node_modules/dist/.turbo/.next excluded via
# .dockerignore) and install with the committed lockfile for a reproducible
# dependency tree. `onlyBuiltDependencies` in pnpm-workspace.yaml ensures the
# argon2 native build step runs non-interactively.
COPY . .
RUN pnpm install --frozen-lockfile

# Build only the backend and the workspace packages it depends on. This runs
# `prisma generate` (via @synora/database's build) and `tsc`, producing
# apps/backend/dist, packages/database/dist, packages/shared/dist, and the
# generated Prisma client under node_modules.
RUN pnpm run build --filter=@synora/backend...

# --- Runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
# The app reads its port from config (default 3001); keep them aligned.
ENV PORT=3001
WORKDIR /app

# Carry over the full workspace as-is, dev dependencies included. Both
# `pnpm prune --prod` and `pnpm deploy` were tried here and rejected: in this
# workspace's node_modules layout, `pnpm prune --prod` run at the workspace
# root deletes every symlink under apps/backend/node_modules — including
# production dependencies like `dotenv` — while leaving the packages
# themselves in the .pnpm store, so `node dist/index.js` fails at the very
# first import with ERR_MODULE_NOT_FOUND. `pnpm deploy` avoids that, but
# performs a fresh install into a new virtual store that does not carry over
# Prisma's already-generated client, breaking `@prisma/client` in a
# different way. Shipping the full, already-correct node_modules the builder
# stage produced sidesteps both failure modes; the extra image size (dev
# tooling: eslint, vitest, typescript, tsup, turbo) is an accepted, explicit
# R1 tradeoff — see docs/production/R1-f_DOCKERFILE.md — revisit with a
# properly-verified `pnpm deploy` (including a post-deploy `prisma generate`)
# in Release 2 if image size becomes a real constraint.
COPY --from=builder /app ./

# Run as the unprivileged `node` user that the base image already provides.
USER node

EXPOSE 3001

# Liveness probe baked into the image. Uses node (no curl in slim) to hit the
# backend's own /health endpoint; the orchestrator's readiness gating should
# use /ready (which additionally probes the database).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/backend/dist/index.js"]
