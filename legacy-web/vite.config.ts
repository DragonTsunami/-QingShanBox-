import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" 让产物既能被任意静态服务器托管，也能被 Tauri / WebView2 以相对路径加载。
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 1421,
    strictPort: true,
    proxy: {
      // 本地 agent 默认端口；前端永远用相对路径 /api/*，接入桌面端时只需换成 Tauri 命令。
      "/api": {
        target: "http://127.0.0.1:7331",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 1422,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
  },
});
