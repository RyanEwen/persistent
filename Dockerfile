# Production image: builds the shared package, the web PWA, and the API, then
# runs a single Node process that serves both the API and the built web app
# (same origin) and applies Prisma migrations on startup.
#
# Build context is the repo root. Used by compose.server.yml.

# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
# OpenSSL so `prisma generate` detects the right engine (debian-openssl-3.0.x),
# matching the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# Install deps first (better layer caching). Copy the lockfile + every workspace
# manifest, then `npm ci` so the workspace symlinks resolve.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
# Generate the Prisma client, then build shared -> web -> api.
RUN npm run db:generate \
 && npm run build --workspace @persistent/shared \
 && npm run build --workspace @persistent/web \
 && npm run build --workspace @persistent/api

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
# Prisma needs OpenSSL at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV API_PORT=4000
ENV WEB_DIST_DIR=/app/apps/web/dist

# Copy the built workspace (node_modules carries the generated Prisma client and
# the @persistent/shared workspace symlink; prisma CLI is present for migrations).
COPY --from=build /app .

EXPOSE 4000
CMD ["npm", "run", "start:prod"]
