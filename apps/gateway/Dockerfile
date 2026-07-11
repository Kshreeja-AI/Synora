# syntax=docker/dockerfile:1
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/gateway/package.json ./apps/gateway/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm --filter @synora/gateway... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/gateway
EXPOSE 8080
CMD ["node", "dist/index.js"]
