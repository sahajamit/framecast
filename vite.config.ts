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
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
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
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
