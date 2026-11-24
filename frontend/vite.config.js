import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Khi chạy dev, mọi request /api và /media được chuyển qua API Gateway (cổng 8080)
const gateway = process.env.VITE_GATEWAY_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: gateway, changeOrigin: true, xfwd: true },
      '/media': { target: gateway, changeOrigin: true },
    },
  },
});
