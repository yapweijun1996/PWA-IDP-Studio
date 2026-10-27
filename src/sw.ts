/// <reference lib="webworker" />
import { PrecacheController, PrecacheRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { cacheNames } from 'workbox-core';
import { requireBuildIdentity } from './lib/installIntegrity';

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_ID__: string;
declare const __PRECACHE_ID__: string;
const BUILD = __BUILD_ID__;
const base = import.meta.env.BASE_URL;
// Build-isolated caches prevent a rejected install from touching the active shell.
const prefix = `idp-shell-${encodeURIComponent(self.registration.scope)}-`;
const precache = new PrecacheController({
  cacheName: `${prefix}${__PRECACHE_ID__}`,
  plugins: [{
    requestWillFetch: async ({ request }) => {
      const url = new URL(request.url);
      url.search = ''; url.searchParams.set('v', BUILD);
      return new Request(url, { cache: 'reload', credentials: 'same-origin' });
    },
  }],
});
// Null revisions retain canonical, query-free cache keys; the cache itself is build-specific.
precache.addToCacheList(self.__WB_MANIFEST.map(entry => ({ url: typeof entry === 'string' ? entry : entry.url, revision: null })));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      await requireBuildIdentity(BUILD, fetch(`${base}build-info.json?v=${encodeURIComponent(BUILD)}`, { cache: 'reload' }));
      await precache.install(event);
    } catch (error) {
      await caches.delete(precache.strategy.cacheName);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await precache.activate(event);
    await Promise.all((await caches.keys()).filter(name => (name.startsWith(prefix) || name === cacheNames.precache) && name !== precache.strategy.cacheName).map(name => caches.delete(name)));
  })());
});
cleanupOutdatedCaches();
registerRoute(new PrecacheRoute(precache, { ignoreURLParametersMatching: [/.*/] }));
registerRoute(new NavigationRoute(precache.createHandlerBoundToURL(`${base}index.html`)));
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
