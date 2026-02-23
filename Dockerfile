# ============================================================================
# SignalForge — Multi-stage Docker build
# Light and fast — no GNU Radio compilation needed!
# ============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN npm install --frozen-lockfile 2>/dev/null || npm install

COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/client/ packages/client/
COPY turbo.json ./

RUN npx turbo run build

# Stage 2: Production
FROM node:20-alpine AS production

LABEL maintainer="WispAyr"
LABEL description="SignalForge — Universal Radio Platform"
LABEL version="0.4.0"

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

RUN npm install --production --frozen-lockfile 2>/dev/null || npm install --production

# Copy built files
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/client/dist packages/client/dist

# Create data directory
RUN mkdir -p /app/data /app/recordings

ENV PORT=3401
ENV NODE_ENV=production

EXPOSE 3401

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3401/api/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
