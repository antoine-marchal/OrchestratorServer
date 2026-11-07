import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3939', changeOrigin: true },
    },
  },
  build: {
    sourcemap: false,
  },
  optimizeDeps: {
    exclude: ['lucide-react', 'monaco-editor'],
  },
});
