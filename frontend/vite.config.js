import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// 本地验证可指定另一 Go 回环端口，避免占用已运行的开发实例。
const backend = process.env.PULSE_BACKEND || 'http://127.0.0.1:8090';
const proxy = { '/ws': { target: backend, ws: true }, '/healthz': backend, '/api': backend };

// 构建输出由 Go 内嵌；开发使用同源代理，生产无需 Node 进程或 CDN。
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()],
  build: { outDir: '../static/dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    proxy,
  },
  preview: { host: '127.0.0.1', proxy },
});
