FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Reproducible install from the committed lockfile (no non-frozen fallback).
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sms/shared build
RUN pnpm --filter @sms/api exec prisma generate
RUN pnpm --filter @sms/api build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3001

# Apply committed migrations before serving. Seed (reference data) is applied separately
# and intentionally NOT run automatically at startup. Override via CMD to skip migrations.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node apps/api/dist/main"]
