import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { version } from './package.json';

function buildId() {
  try {
    const root = process.cwd();
    const dotGit = resolve(root, '.git');
    const git = existsSync(resolve(dotGit, 'HEAD')) ? dotGit : resolve(root, readFileSync(dotGit, 'utf8').trim().replace(/^gitdir:\s*/, ''));
    const head = readFileSync(resolve(git, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head.slice(0, 7);
    const ref = head.slice(5);
    const common = existsSync(resolve(git, 'commondir')) ? resolve(git, readFileSync(resolve(git, 'commondir'), 'utf8').trim()) : git;
    if (existsSync(resolve(common, ref))) return readFileSync(resolve(common, ref), 'utf8').trim().slice(0, 7);
    return readFileSync(resolve(common, 'packed-refs'), 'utf8').split('\n').find(line => line.endsWith(` ${ref}`))?.split(' ')[0].slice(0, 7) ?? 'dev';
  } catch { return 'dev'; }
}

const base = '/PWA-IDP-Studio/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_ID__: JSON.stringify(process.env.IDP_BUILD_ID || buildId()) },
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
