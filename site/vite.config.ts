import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    emptyOutDir: true,
    outDir: 'dist/client',
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name][extname]',
        entryFileNames: 'assets/app.js'
      }
    }
  }
});
