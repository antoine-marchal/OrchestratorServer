import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
   resolve: {
     alias: {
       "@": fileURLToPath(new URL('./src', import.meta.url))
     }
   },
  base: './',
  build: {
    sourcemap: false,
    minify: 'esbuild',
  },
  optimizeDeps: {
    exclude: ['lucide-react', 'monaco-editor'],
  },
});
