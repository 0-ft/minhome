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
RUN pnpm install --frozen-lockfile

# Copy source
COPY server/src server/src
COPY server/tsconfig.json server/
COPY frontend/ frontend/

# Build frontend
RUN pnpm --filter @minhome/frontend build

# Production stage
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY --from=base /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/tsconfig.base.json ./
COPY --from=base /app/server/package.json server/
COPY --from=base /app/cli/package.json cli/
COPY --from=base /app/frontend/package.json frontend/
COPY --from=base /app/node_modules node_modules/
COPY --from=base /app/server/node_modules server/node_modules/

COPY --from=base /app/server/src server/src
COPY --from=base /app/frontend/dist frontend/dist

ENV NODE_ENV=production
ENV PORT=3111
EXPOSE 3111

CMD ["pnpm", "--filter", "@minhome/server", "start"]

