import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Builds a single self-contained IIFE bundle for the Tampermonkey userscript.
 * `scripts/build-userscript.mjs` wraps the JavaScript and extracted CSS in the
 * userscript metadata and shadow-root bootstrapper.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist-userscript',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    cssCodeSplit: false,
    // The userscript must stay a single file: inline images (logo, favicons)
    // instead of emitting separate assets that would break the bundle.
    assetsInlineLimit: 1024 * 1024,
    lib: {
      entry: resolve(import.meta.dirname, 'src/userscript-entry.tsx'),
      name: 'RouteCraftUserScript',
      formats: ['iife'],
      fileName: () => 'routecraft-app.js',
      cssFileName: 'routecraft-app',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

