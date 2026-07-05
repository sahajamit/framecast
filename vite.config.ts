/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-onair.svg'],
      workbox: {
        // tflite: the bundled selfie-segmentation model. The MediaPipe wasm
        // runtime (~11 MB) is precached too so the camera background works
        // offline, hence the raised size cap.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,wasm,woff2,tflite}'],
        // High-tier matting assets (onnxruntime wasm + the ~15 MB RVM model)
        // must NOT be precached: only WebGPU devices with a background active
        // ever fetch them (invariant #11). They runtime-cache below instead,
        // so high-tier users still get offline matting after first use.
        globIgnores: ['**/ort/**', '**/models/*.onnx'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/ort\/.*\.(wasm|mjs)$|\/models\/.*\.onnx$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'framecast-matting-high',
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'framecast',
        short_name: 'framecast',
        description:
          'Fully-local screen + camera recorder for creators. Nothing ever leaves your machine.',
        theme_color: '#131110',
        background_color: '#131110',
        display: 'standalone',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
  // Mirror the production COOP/COEP headers (netlify.toml) so dev == prod:
  // cross-origin isolation enables SharedArrayBuffer / threaded WASM for the
  // camera-background CPU tier (issue #11).
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
