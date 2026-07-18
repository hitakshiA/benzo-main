import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const eercSdkPath = fileURLToPath(new URL("./node_modules/@avalabs/eerc-sdk/dist/index.js", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { global: "globalThis" },
  resolve: {
    alias: {
      "@avalabs/eerc-sdk": eercSdkPath,
    },
  },
  build: {
    // Split the always-loaded vendor libs into separate, cacheable chunks that
    // download in parallel. The heavy proving machinery (@avalabs/eerc-sdk,
    // snarkjs, ffjavascript) is NOT listed here, it is reached only through
    // dynamic import()s, so Rollup emits it as an on-demand async chunk that
    // never lands in the initial payload.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "react-vendor";
          if (/[\\/]node_modules[\\/](viem|wagmi|@tanstack|abitype|ox|@noble|@scure)[\\/]/.test(id)) return "web3-vendor";
          if (/[\\/]node_modules[\\/](framer-motion|motion|motion-dom|lucide-react)[\\/]/.test(id)) return "ui-vendor";
        },
      },
    },
  },
  server: { port: 5175, proxy: { "/api": "http://localhost:8791" } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    server: { deps: { inline: ["@avalabs/eerc-sdk"] } },
  },
});
