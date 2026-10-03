import path from "node:path";
import { readFileSync } from "node:fs";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const anmPlayerVersion = readFileSync(path.resolve(import.meta.dirname, "../../VERSION"), "utf8").trim();

export default defineConfig(({ mode }) => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const env = { ...loadEnv(mode, repositoryRoot, ""), ...process.env };
  const apiTarget = env.AURA_API_PROXY_TARGET ?? `http://127.0.0.1:${env.AURA_API_PORT ?? "8000"}`;
  const token = env.API_ACCESS_TOKEN?.trim();

  return {
    plugins: [react()],
    define: {
      __ANM_PLAYER_VERSION__: JSON.stringify(anmPlayerVersion),
    },
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          ws: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("react-dom") || id.includes("react-router") || /[/\\]react[/\\]/.test(id)) return "vendor-react";
            if (id.includes("@tanstack")) return "vendor-query";
            if (id.includes("framer-motion")) return "vendor-motion";
            if (id.includes("@dnd-kit")) return "vendor-dnd";
            if (id.includes("@radix-ui")) return "vendor-radix";
            return undefined;
          },
        },
      },
    },
  };
});
