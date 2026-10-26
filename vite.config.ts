import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = '/PWA-IDP-Studio/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // User-controlled update: the new worker waits until the user clicks Update.
      registerType: 'prompt',
      manifest: {
        name: 'IDP Studio',
        short_name: 'IDP Studio',
        description: 'Drop documents, get validated JSON.',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Documents and AI responses are never cached by the worker.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,mjs}'],
        navigateFallback: `${base}index.html`,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Provider SDK chunks that are lazy-loaded and unused by the supported providers.
        globIgnores: ['**/mistral-*', '**/anthropic-*', '**/google-vertex-*', '**/azure-openai-*', '**/openai-codex-*', '**/bedrock-*'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
