import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:3111";

// Everything outside the Vite root that the dev server may read. The dev
// server is LAN-only and unauthenticated, so keep secrets out of reach even
// there: /@fs/ can otherwise serve any file under the workspace root.
const repoRoot = resolve(import.meta.dirname, "..");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: "dist-app",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          "react-three": [
            "@react-three/fiber",
            "@react-three/drei",
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Only the hosts the dev server is legitimately reached by: the compose
    // service name (the server proxies to http://frontend:5173) and localhost.
    // LAN access by IP is permitted by Vite already. Deliberately NOT `true`,
    // so a public hostname such as the tunnel's is refused outright.
    allowedHosts: ["frontend", "localhost"],
    // No `hmr` override on purpose: it exists only to drive HMR through a
    // public proxy, which we never do.
    fs: {
      strict: true,
      // Allowlist, not a blocklist: /@fs/ may only reach the frontend itself
      // and installed packages. Everything else in the repo — data/, server/,
      // infra/, .env — is outside the root and therefore refused.
      allow: [
        resolve(repoRoot, "frontend"),
        resolve(repoRoot, "node_modules"),
        // Shared pure module (vibe artwork), not the rest of server/
        resolve(repoRoot, "server/src/vibe-art.ts"),
      ],
      // Belt and braces for secrets that could sit inside an allowed dir.
      // Supplying `deny` replaces Vite's defaults, so restate them.
      deny: [
        "**/.env",
        "**/.env.*",
        "**/*.{crt,pem}",
        "**/.git/**",
      ],
    },
    proxy: {
      "/api": apiTarget,
      "/ws": { target: apiTarget.replace(/^http/, "ws"), ws: true },
      "/ws/debug": { target: apiTarget.replace(/^http/, "ws"), ws: true },
    },
  },
});
