import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Relative base so the build works from any sub-path on GitHub Pages
  // (/happy/0907/dist/) without knowing the deploy URL at build time.
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // three is large and changes rarely — keep it in its own chunk so the
        // game code can be re-downloaded without re-fetching the engine.
        manualChunks: { three: ['three'] },
      },
    },
  },
  server: { host: true, port: 5173 },
});
