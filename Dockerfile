FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

# Copy Backend subdirectories to root
COPY Backend/app ./app
COPY Backend/components ./components
COPY Backend/hooks ./hooks
COPY Backend/lib ./lib
COPY Backend/config ./config
COPY Backend/middleware ./middleware
COPY Backend/services ./services
COPY Backend/enterprise ./enterprise
COPY Backend/application ./application
COPY Backend/domains ./domains
COPY Backend/infrastructure ./infrastructure

# Also copy Backend itself
COPY Backend ./Backend

# Root files
COPY prisma ./prisma
COPY package.json ./
COPY tsconfig.json ./
COPY next.config.js ./
COPY tailwind.config.js ./
COPY postcss.config.js ./
COPY middleware.ts ./middleware.ts

RUN mkdir -p public

RUN npx prisma generate --schema=./prisma/schema.prisma

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ============================
# Runtime
# ============================

FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

RUN mkdir -p public

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

USER nextjs

EXPOSE 3000

CMD ["sh", "-c", "HOSTNAME=0.0.0.0 PORT=${PORT:-3000} node server.js"]
