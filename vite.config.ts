/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Cross-origin isolation enables the multi-threaded Stockfish build (SharedArrayBuffer).
// Hosts that cannot send these headers automatically fall back to the single-threaded build.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'engine/STOCKFISH-LICENSE.txt'],
      manifest: {
        name: 'Outpost — Chess Analysis Lab',
        short_name: 'Outpost',
        description: 'Analyze chess games with Stockfish running locally in your browser.',
        theme_color: '#11141a',
        background_color: '#11141a',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm,json,txt,webmanifest}'],
        // The asm.js fallback (3 MB) is only fetched — and then runtime-cached — when WebAssembly is unavailable.
        globIgnores: ['**/stockfish-19-asm.js', 'sw.js'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  worker: { format: 'es' },
  server: { headers: isolationHeaders, host: true, allowedHosts: true },
  preview: { headers: isolationHeaders, host: true, allowedHosts: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
