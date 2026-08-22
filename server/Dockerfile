FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy package.json for each workspace
COPY server/package.json server/
COPY cli/package.json cli/
COPY frontend/package.json frontend/

# Install all deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source
COPY server/src server/src
COPY server/tsconfig.json server/
COPY frontend/ frontend/

# Build frontend and server (constrain heap for low-memory devices)
RUN NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter @minhome/frontend build
RUN NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter @minhome/server build

# Production stage
FROM node:22-slim

# Chromium renders the display images: the TRMNL framework ships a terminalize()
# runtime that measures layout after the fact, so a real browser engine is required.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium

RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY --from=base /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=base /app/server/package.json server/
COPY --from=base /app/cli/package.json cli/
COPY --from=base /app/frontend/package.json frontend/

# Install production deps only
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile

# Copy compiled server output and frontend build
COPY --from=base /app/server/dist server/dist
COPY --from=base /app/frontend/dist-app frontend/dist-app
COPY --from=base /app/frontend/dist-login frontend/dist-login

# TRMNL framework assets, and the absolute /fonts path its stylesheet expects.
# The symlink keeps the vendored CSS byte-identical to upstream.
COPY server/vendor server/vendor
RUN ln -s /app/server/vendor/trmnl-framework/fonts /fonts

ENV NODE_ENV=production
ENV PORT=3111
EXPOSE 3111

CMD ["node", "server/dist/index.js"]
