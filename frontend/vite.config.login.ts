import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/login/",
  build: {
    outDir: "dist-login",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: "login.html",
    },
  },
});
