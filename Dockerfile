# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Synora backend API — production image.
#
# Multi-stage: a builder stage installs the full pnpm workspace, generates the
# Prisma client, and compiles the backend and its workspace dependencies
# (@synora/database, @synora/shared); the runtime stage carries only what is
# needed to run `node apps/backend/dist/index.js` as a non-root user.
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

# Drop dev dependencies from node_modules so the runtime image doesn't ship
# compilers, eslint, vitest, etc. The generated Prisma client and the argon2
# native binary live under node_modules and are preserved by prune.
RUN pnpm prune --prod

# --- Runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
# The app reads its port from config (default 3001); keep them aligned.
ENV PORT=3001
WORKDIR /app

# Carry over the pruned workspace: the pnpm symlink layout under node_modules
# is what resolves @synora/database and @synora/shared, so the whole tree is
# copied to preserve those links and the generated Prisma client.
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
