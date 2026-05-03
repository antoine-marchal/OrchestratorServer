import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json';


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
   resolve: {
     alias: {
       "@": fileURLToPath(new URL('./src', import.meta.url))
     }
   },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  base: './',
  build: {
    sourcemap: false,
    minify: 'esbuild',
    assetsInlineLimit: 1024 * 1024 * 10, // inline everything up to 10 MB (covers woff2 fonts)
  },
  optimizeDeps: {
    exclude: ['lucide-react', 'monaco-editor'],
  },
});
