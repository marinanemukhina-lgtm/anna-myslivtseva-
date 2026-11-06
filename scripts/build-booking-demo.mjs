import { build } from 'vite';
await build({ configFile: false, resolve: { alias: { 'node:crypto': new URL('../src/demo-random.mjs', import.meta.url).pathname } }, build: { outDir: '.qa/demo-dist', emptyOutDir: true,
  rollupOptions: { input: 'booking-demo.html' } } });
