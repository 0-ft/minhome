sudo rm -rf node_modules cli/node_modules frontend/node_modules server/node_modules .pnpm-store/
docker builder prune --filter type=exec.cachemount 2>&1
