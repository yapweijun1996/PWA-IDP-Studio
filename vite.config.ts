import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
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

// Node 25 enables a built-in localStorage that shadows jsdom's, breaking tests ("localStorage.clear is not a function").
// Feature-detect the opt-out flag so older Node versions never receive an unknown option.
const noNodeWebStorage = process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage') ? ['--no-experimental-webstorage'] : [];

const base = '/PWA-IDP-Studio/';
const BUILD = process.env.IDP_BUILD_ID || buildId();

/**
 * PDF.js fetches non-embedded fonts and CJK CMaps at run time (see PDFJS_ASSETS in src/lib/agent/pageSource.ts).
 * Emit them under pdfjs/ in the build and serve the same paths from the dev server.
 */
function pdfjsAssets(): Plugin {
  const root = resolve(process.cwd(), 'node_modules/pdfjs-dist');
  const dirs = ['standard_fonts', 'cmaps'];
  return {
    name: 'pdfjs-assets',
    generateBundle() {
      for (const dir of dirs) for (const name of readdirSync(resolve(root, dir))) this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: readFileSync(resolve(root, dir, name)) });
    },
    configureServer(server) {
      server.middlewares.use(`${base}pdfjs/`, (req, res, next) => {
        const file = resolve(root, decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, ''));
        if (!dirs.some(dir => file.startsWith(resolve(root, dir) + sep)) || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_ID__: JSON.stringify(BUILD), __PRECACHE_ID__: JSON.stringify(`${BUILD}-${Date.now()}`) },
  plugins: [
    react(),
    pdfjsAssets(),
    { name: 'build-identity', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify({ build: BUILD }) }); } },
    VitePWA({
      // User-controlled update: the new worker waits until the user clicks Update.
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
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
      injectManifest: {
        // App shell only. Documents and AI responses are never cached by the worker. The PDF.js standard fonts
        // (pfb/ttf, ~0.8 MB) are cached so stored PDFs keep rendering offline; the CJK CMaps (~1.5 MB) are online-only.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,mjs,pfb,ttf}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Provider SDK chunks that are lazy-loaded and unused by the supported providers.
        globIgnores: ['**/mistral-*', '**/anthropic-*', '**/google-vertex-*', '**/azure-openai-*', '**/openai-codex-*', '**/bedrock-*'],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/ui/validation.test.tsx'], poolOptions: { forks: { execArgv: noNodeWebStorage } } },
});
