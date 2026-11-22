import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:18763', changeOrigin: false },
      '/roms': { target: 'http://127.0.0.1:18763', changeOrigin: false },
      '/support-assets': { target: 'http://127.0.0.1:18763', changeOrigin: false },
      '/app/xiaoniubawang/support-assets': { target: 'http://127.0.0.1:18763', changeOrigin: false },
      '/app/xiaoniubawang/api': { target: 'http://127.0.0.1:18763', changeOrigin: false },
    },
  },
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'jsdom', restoreMocks: true, include: ['tests/**/*.test.{ts,tsx}'] },
});
