import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [vue()],
  // 开发模式下将 API 代理到 pnpm dev 启动的后端（固定端口 3888）。
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3888",
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});
