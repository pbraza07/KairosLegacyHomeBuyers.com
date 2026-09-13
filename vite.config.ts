import { defineConfig } from "vite";
export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, warn) {
        // React Router and Radix ship harmless framework directives for
        // environments such as Next.js. Vite already bundles these modules
        // correctly; filter only this known informational warning.
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes('"use client"')
        )
          return;
        warn(warning);
      },
    },
  },
  server: { host: "0.0.0.0", allowedHosts: ["localhost", "terminal.local"] },
});
