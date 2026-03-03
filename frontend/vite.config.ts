import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:3111";
const hmrHost = process.env.VITE_HMR_HOST;
const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT
  ? parseInt(process.env.VITE_HMR_CLIENT_PORT, 10)
  : undefined;
const hmrProtocol = process.env.VITE_HMR_PROTOCOL as "ws" | "wss" | undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
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
    allowedHosts: true,
    hmr:
      hmrHost || hmrClientPort || hmrProtocol
        ? {
            host: hmrHost,
            clientPort: hmrClientPort,
            protocol: hmrProtocol,
          }
        : undefined,
    proxy: {
      "/api": apiTarget,
      "/ws": { target: apiTarget.replace(/^http/, "ws"), ws: true },
      "/ws/debug": { target: apiTarget.replace(/^http/, "ws"), ws: true },
    },
  },
});
