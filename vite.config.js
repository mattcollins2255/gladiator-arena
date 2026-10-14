import { defineConfig } from 'vite';

// Target modern browsers so we can use top-level await in main.js.
// base './' makes asset paths relative so the build works from any URL (e.g. GitHub Pages' /repo-name/).
export default defineConfig({
  base: './',
  build: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
});
