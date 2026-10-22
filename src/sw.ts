/// <reference lib="webworker" />
/**
 * Nocturne64 service worker.
 *  1. Precaches the app shell, the Stockfish WASM builds and the opening data so the
 *     analysis lab works offline after the first visit.
 *  2. Adds cross-origin isolation headers (COOP/COEP/CORP) to every same-origin response.
 *     This enables SharedArrayBuffer — and therefore the multi-threaded engine — even on
 *     static hosts that cannot configure response headers.
 */
import { cleanupOutdatedCaches, PrecacheController } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

const precache = new PrecacheController();
precache.addToCacheList(self.__WB_MANIFEST);
const RUNTIME = 'nocturne64-runtime-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precache.install(event));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([precache.activate(event), self.clients.claim()]));
});
cleanupOutdatedCaches();

function withIsolation(res: Response): Response {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function fromPrecache(url: string): Promise<Response | undefined> {
  const key = precache.getCacheKeyForURL(url);
  if (!key) return undefined;
  const cache = await caches.open(precache.strategy.cacheName);
  return (await cache.match(key)) ?? undefined;
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.hash = '';
  let res = await fromPrecache(url.href);
  if (!res && request.mode === 'navigate') {
    // Single-page app: serve the shell for navigations; prefer the network when online.
    try {
      res = await fetch(request);
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      res = await fromPrecache(new URL('index.html', self.registration.scope).href);
    }
  }
  if (!res) {
    const cache = await caches.open(RUNTIME);
    const cached = await cache.match(request);
    if (cached) res = cached;
    else {
      res = await fetch(request);
      if (res.ok && /\/engine\/.+\.(js|wasm)$/.test(url.pathname)) void cache.put(request, res.clone());
    }
  }
  return withIsolation(res);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(handle(req));
});
