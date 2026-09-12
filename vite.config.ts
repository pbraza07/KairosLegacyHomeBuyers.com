import { defineConfig } from "vite";
export default defineConfig({
  root: ".",
  publicDir: "public",
  build: { outDir: "dist/client", emptyOutDir: true },
  server: { host: "0.0.0.0", allowedHosts: ["localhost", "terminal.local"] },
});
