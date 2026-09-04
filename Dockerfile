# ── Build stage ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Prisma needs OpenSSL to build/generate the correct query engine on Alpine (musl).
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma/
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# OpenSSL is required by the Prisma query engine at runtime on Alpine.
RUN apk add --no-cache openssl

# Security: run as non-root user
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -D appuser

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY prisma ./prisma/
RUN npx prisma generate

COPY --from=builder /app/dist ./dist/

# Create uploads directory (mount a persistent volume here in production)
RUN mkdir -p uploads

# Give the non-root user ownership of the whole app dir so Prisma can read its
# engines (and write if it ever needs to) at runtime.
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5001/api/health || exit 1

# Apply pending DB migrations, then start the server.
CMD ["npm", "run", "start:migrate"]
