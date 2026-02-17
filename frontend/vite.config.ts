import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:3111";

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
    proxy: {
      "/api": apiTarget,
      "/ws": { target: apiTarget.replace(/^http/, "ws"), ws: true },
      "/ws/debug": { target: apiTarget.replace(/^http/, "ws"), ws: true },
    },
  },
});
