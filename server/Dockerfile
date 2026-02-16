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

# Build frontend and server
RUN pnpm --filter @minhome/frontend build
RUN pnpm --filter @minhome/server build

# Production stage
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
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
COPY --from=base /app/frontend/dist frontend/dist

ENV NODE_ENV=production
ENV PORT=3111
EXPOSE 3111

CMD ["node", "--max-old-space-size=256", "server/dist/index.js"]
