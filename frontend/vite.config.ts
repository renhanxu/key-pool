import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发时把 /api 与 /v1 代理到本地 Workers（wrangler dev 默认端口 8787）
      // 注意：统一用 127.0.0.1 而非 localhost，避免 Vite 监听 IPv6(::1)、
      // 而 wrangler dev 监听 IPv4(127.0.0.1) 时，localhost 解析到 ::1 导致代理 404。
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/v1": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/channels": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/aggregate-keys": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/stats": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/playground": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
